module.exports = function(RED) {
    "use strict";

    // Register definitions for Lidar Lite v3
    const LLv3_ACQ_CMD = 0x00;
    const LLv3_STATUS = 0x01;
    const LLv3_SIG_CNT_VAL = 0x02;
    const LLv3_ACQ_CONFIG = 0x04;
    const LLv3_DISTANCE = 0x0f;
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
    function configure(port, address, mode) {
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
        writeRegister(port, address, LLv3_ACQ_CMD, 0x04);
    }

    // Check the busy flag
    function getBusyFlag(port, address) {
        const status = readRegisters(port, address, LLv3_STATUS, 1)[0];
        return status & 0x01;
    }

    // Wait for the device to be ready
    function waitForBusy(port, address) {
        const timeout = 1000; // 1 second timeout
        const start = Date.now();
        while (getBusyFlag(port, address)) {
            if (Date.now() - start > timeout) {
                throw new Error("Timeout waiting for device to be ready");
            }
        }
    }

    // Read the distance measurement
    function readDistance(port, address) {
        const buffer = readRegisters(port, address, LLv3_DISTANCE, 2);
        return (buffer[0] << 8) | buffer[1];
    }

    // Node constructor
    function LidarLiteNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Parse configuration parameters
        const busno = parseInt(config.busno, 10) || 1;
        let address = parseAddress(config.address) || 0x62;
        const mode = parseInt(config.mode, 10) || 0;
        const newAddress = config.newAddress ? parseAddress(config.newAddress) : null;
        const disableDefault = config.disableDefault || false;
        const readCorrelation = config.readCorrelation || false;
        const correlationReadings = parseInt(config.correlationReadings, 10) || 256;

        let port;
        try {
            const I2C = require("i2c-bus");
            port = I2C.openSync(busno);
            node.status({ fill: "green", shape: "dot", text: "connected" });
        } catch (err) {
            node.error("Failed to open I2C bus: " + err);
            node.status({ fill: "red", shape: "ring", text: "bus error" });
            return;
        }

        // Set new I2C address if specified
        if (newAddress) {
            try {
                setI2Caddr(port, address, newAddress, disableDefault);
                address = newAddress; // Update address for subsequent operations
            } catch (err) {
                node.error("Failed to set new I2C address: " + err);
                node.status({ fill: "red", shape: "ring", text: "address error" });
                return;
            }
        }

        // Configure the device
        try {
            configure(port, address, mode);
        } catch (err) {
            node.error("Failed to configure Lidar Lite: " + err);
            node.status({ fill: "red", shape: "ring", text: "config error" });
            return;
        }

        // Handle input messages
        node.on('input', function(msg) {
            try {
                takeRange(port, address);
                waitForBusy(port, address);
                const distance = readDistance(port, address);
                msg.payload = { distance: distance };

                if (readCorrelation) {
                    const correlation = correlationRecordRead(port, address, correlationReadings);
                    msg.payload.correlation = correlation;
                }

                node.send(msg);
                node.status({ fill: "green", shape: "dot", text: "distance: " + distance });
            } catch (err) {
                node.error("Measurement error: " + err, msg);
                node.status({ fill: "yellow", shape: "ring", text: "error" });
            }
        });

        // Clean up on node close
        node.on('close', function() {
            try {
                port.closeSync();
                node.status({});
            } catch (err) {
                node.error("Failed to close I2C bus: " + err);
            }
        });
    }

    RED.nodes.registerType("lidar lite", LidarLiteNode);
}