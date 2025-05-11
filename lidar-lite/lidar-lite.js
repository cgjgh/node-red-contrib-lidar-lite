module.exports = function(RED) {
    "use strict";

    // Register definitions for Lidar Lite v3
    const LLv3_ACQ_CMD = 0x00;
    const LLv3_STATUS = 0x01;
    const LLv3_SIG_CNT_VAL = 0x02;
    const LLv3_ACQ_CONFIG = 0x04;
    const LLv3_DISTANCE = 0x0f; // Note: This reads distance in cm
    const LLv3_REF_CNT_VAL = 0x12;
    const LLv3_THRESH_BYPASS = 0x1c;
    const LLv3_UNIT_ID_HIGH = 0x16;
    const LLv3_I2C_ID_HIGH = 0x18;
    const LLv3_I2C_SEC_ADR = 0x1a;
    const LLv3_I2C_CONFIG = 0x1b;
    const LLv3_ACQ_SETTINGS = 0x47;
    const LLv3_COMMAND = 0x40;
    const LLv3_CORR_DATA = 0x52;

    // Utility function to parse address (hex or decimal)
    function parseAddress(addr) {
        if (typeof addr === 'string') {
            if (addr.startsWith('0x')) {
                return parseInt(addr, 16);
            }
            return parseInt(addr, 10);
        }
        return addr;
    }

    // I2C write to a single register
    function writeRegister(port, address, reg, value) {
        port.writeByteSync(address, reg, value);
    }

    // I2C read from consecutive registers
    function readRegisters(port, address, reg, numBytes) {
        const buffer = Buffer.alloc(numBytes);
        port.readI2cBlockSync(address, reg, numBytes, buffer);
        return buffer;
    }

    // Configure the device based on mode
    function configureDevice(port, address, mode) { // Renamed to avoid conflict
        let sigCountMax, acqConfigReg, refCountMax, thresholdBypass;
        switch (mode) {
            case 0: sigCountMax = 0x80; acqConfigReg = 0x08; refCountMax = 0x05; thresholdBypass = 0x00; break;
            case 1: sigCountMax = 0x1d; acqConfigReg = 0x08; refCountMax = 0x03; thresholdBypass = 0x00; break;
            case 2: sigCountMax = 0x80; acqConfigReg = 0x00; refCountMax = 0x03; thresholdBypass = 0x00; break;
            case 3: sigCountMax = 0xff; acqConfigReg = 0x08; refCountMax = 0x05; thresholdBypass = 0x00; break;
            case 4: sigCountMax = 0x80; acqConfigReg = 0x08; refCountMax = 0x05; thresholdBypass = 0x80; break;
            case 5: sigCountMax = 0x80; acqConfigReg = 0x08; refCountMax = 0x05; thresholdBypass = 0xb0; break;
            case 6: sigCountMax = 0x04; acqConfigReg = 0x01; refCountMax = 0x03; thresholdBypass = 0x00; break;
            default: sigCountMax = 0x80; acqConfigReg = 0x08; refCountMax = 0x05; thresholdBypass = 0x00; break;
        }
        writeRegister(port, address, LLv3_SIG_CNT_VAL, sigCountMax);
        writeRegister(port, address, LLv3_ACQ_CONFIG, acqConfigReg);
        writeRegister(port, address, LLv3_REF_CNT_VAL, refCountMax);
        writeRegister(port, address, LLv3_THRESH_BYPASS, thresholdBypass);
    }

    // Set new I2C address
    function setI2Caddr(port, currentAddress, newAddress, disableDefault) {
        const unitId = readRegisters(port, currentAddress, LLv3_UNIT_ID_HIGH | 0x80, 2);
        port.writeI2cBlockSync(currentAddress, LLv3_I2C_ID_HIGH, 2, unitId);
        writeRegister(port, currentAddress, LLv3_I2C_SEC_ADR, newAddress);
        writeRegister(port, currentAddress, LLv3_I2C_CONFIG, 0);
        if (disableDefault) {
            writeRegister(port, newAddress, LLv3_I2C_CONFIG, 1 << 3);
        }
    }

    // Read correlation record
    function correlationRecordRead(port, address, numberOfReadings) {
        const correlationArray = [];
        writeRegister(port, address, LLv3_ACQ_SETTINGS, 0xc0); // Select memory bank
        writeRegister(port, address, LLv3_COMMAND, 0x07); // Enable test mode
        for (let i = 0; i < numberOfReadings; i++) {
            const data = readRegisters(port, address, LLv3_CORR_DATA | 0x80, 2);
            const magnitude = data[0];
            const sign = data[1] ? 0xff : 0x00;
            const correlationValue = (sign << 8) | magnitude;
            correlationArray.push(correlationValue);
        }
        writeRegister(port, address, LLv3_COMMAND, 0); // Disable test mode
        return correlationArray;
    }

    // Trigger a distance measurement
    function takeRange(port, address) {
        writeRegister(port, address, LLv3_ACQ_CMD, 0x04); // Trigger acquisition with bias correction
    }

    // Check the busy flag
    function getBusyFlag(port, address) {
        const status = readRegisters(port, address, LLv3_STATUS, 1)[0];
        return status & 0x01; // Bit 0 is the busy flag
    }

    // Wait for the device to be ready
    function waitForBusy(port, address) {
        const timeout = 200; // Max acquisition time ~20ms, allow 200ms
        const start = Date.now();
        while (getBusyFlag(port, address)) {
            if (Date.now() - start > timeout) {
                throw new Error("Timeout waiting for device to be ready (busy flag)");
            }
        }
    }

    // Read the distance measurement (in cm)
    function readDistanceCm(port, address) {
        const buffer = readRegisters(port, address, LLv3_DISTANCE | 0x80, 2); // Add 0x80 for auto-increment for repeated reads
        return (buffer[0] << 8) | buffer[1];
    }

    // Convert distance from cm to target units
    function convertUnits(distanceCm, targetUnits) {
        switch (targetUnits) {
            case 'm':
                return distanceCm / 100;
            case 'in':
                return distanceCm / 2.54;
            case 'ft':
                return distanceCm / 30.48;
            case 'cm':
            default:
                return distanceCm;
        }
    }


    // Node constructor
    function LidarLiteNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.busno = parseInt(config.busno, 10) || 1;
        node.address = parseAddress(config.address) || 0x62;
        node.mode = parseInt(config.mode, 10) || 0;
        node.newAddress = config.newAddress ? parseAddress(config.newAddress) : null;
        node.disableDefault = config.disableDefault || false;
        node.readCorrelation = config.readCorrelation || false;
        node.correlationReadings = parseInt(config.correlationReadings, 10) || 256;
        node.units = config.units || "cm";
        node.intervalToggle = config.intervalToggle || false;
        node.intervalValue = parseInt(config.intervalValue, 10) || 1;
        node.intervalUnits = config.intervalUnits || "s";

        let port;
        let intervalId = null;
        let retryTimeoutId = null;
        let currentDeviceAddress = node.address; // Keep track of the current address

        function initializeDevice() {
            try {
                if (port) { // Close existing port if retrying
                    try { port.closeSync(); } catch (e) { /* ignore */ }
                    port = null;
                }
                const I2C = require("i2c-bus");
                port = I2C.openSync(node.busno);
                node.status({ fill: "yellow", shape: "ring", text: "initializing..." });

                // Set new I2C address if specified
                if (node.newAddress && node.newAddress !== currentDeviceAddress) {
                    try {
                        setI2Caddr(port, currentDeviceAddress, node.newAddress, node.disableDefault);
                        currentDeviceAddress = node.newAddress; // Update address for subsequent operations
                        node.log(`Set new I2C address to 0x${currentDeviceAddress.toString(16)}`);
                    } catch (err) {
                        node.error(`Failed to set new I2C address: ${err.message}`, err);
                        node.status({ fill: "red", shape: "ring", text: "address error" });
                        scheduleRetry();
                        return;
                    }
                }

                // Configure the device
                configureDevice(port, currentDeviceAddress, node.mode);
                node.status({ fill: "green", shape: "dot", text: "connected" });
                node.log(`Lidar Lite initialized at 0x${currentDeviceAddress.toString(16)} on bus ${node.busno}`);

                if (retryTimeoutId) {
                    clearTimeout(retryTimeoutId);
                    retryTimeoutId = null;
                }
                startIntervalMeasurement(); // Start interval if configured

            } catch (err) {
                node.error(`Initialization failed: ${err.message}`, err);
                node.status({ fill: "red", shape: "ring", text: "init error" });
                scheduleRetry();
            }
        }

        function scheduleRetry() {
            if (port) {
                try { port.closeSync(); } catch(e) { /* ignore */ }
                port = null;
            }
            if (retryTimeoutId) clearTimeout(retryTimeoutId); // Clear existing retry timeout
            retryTimeoutId = setTimeout(() => {
                node.log("Retrying initialization...");
                initializeDevice();
            }, 10000); // Retry every 10 seconds
             node.status({ fill: "red", shape: "ring", text: "retry in 10s" });
        }

        function performMeasurement() {
            if (!port) {
                node.warn("Port not open, attempting to reinitialize.");
                initializeDevice(); // Attempt to reinitialize if port is lost
                return;
            }
            try {
                takeRange(port, currentDeviceAddress);
                waitForBusy(port, currentDeviceAddress);
                const distanceCm = readDistanceCm(port, currentDeviceAddress);
                const distanceConverted = convertUnits(distanceCm, node.units);

                const msg = { payload: { distance: distanceConverted, units: node.units } };

                if (node.readCorrelation) {
                    const correlation = correlationRecordRead(port, currentDeviceAddress, node.correlationReadings);
                    msg.payload.correlation = correlation;
                }

                node.send(msg);
                node.status({ fill: "green", shape: "dot", text: `dist: ${distanceConverted.toFixed(2)} ${node.units}` });
            } catch (err) {
                node.error(`Measurement error: ${err.message}`, err);
                node.status({ fill: "yellow", shape: "ring", text: "meas. error" });
                // Consider if a retry should be scheduled here too, or if re-init is enough
                if (err.message.includes("Timeout") || err.code === 'ENXIO' || err.errno === -6 || err.syscall === 'ioctl') {
                    node.warn("Device communication error during measurement, attempting re-initialization.");
                    scheduleRetry();
                }
            }
        }

        function calculateIntervalMillis() {
            let multiplier = 1;
            switch (node.intervalUnits) {
                case 's': multiplier = 1000; break;
                case 'min': multiplier = 60000; break;
                case 'ms':
                default: multiplier = 1; break;
            }
            return node.intervalValue * multiplier;
        }

        function startIntervalMeasurement() {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
            if (node.intervalToggle && port) { // Only start if toggled and port is available
                const intervalMs = calculateIntervalMillis();
                if (intervalMs > 0) {
                    intervalId = setInterval(performMeasurement, intervalMs);
                    node.log(`Started interval measurement every ${intervalMs}ms`);
                }
            }
        }

        initializeDevice(); // Initial attempt to connect and configure

        node.on('input', function(msg, send, done) {
            if (!node.intervalToggle) { // Only process input if interval is not active
                performMeasurement();
            }
            if (done) {
                done();
            }
        });

        node.on('close', function(removed, done) {
            if (retryTimeoutId) {
                clearTimeout(retryTimeoutId);
            }
            if (intervalId) {
                clearInterval(intervalId);
            }
            if (port) {
                try {
                    port.closeSync();
                    node.log("I2C bus closed.");
                } catch (err) {
                    node.error(`Failed to close I2C bus: ${err.message}`, err);
                } finally {
                    port = null;
                }
            }
            node.status({});
            if (done) {
                done();
            }
        });
    }

    RED.nodes.registerType("lidar lite", LidarLiteNode);
}