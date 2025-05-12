# Node-RED Lidar Lite v3 Node

This Node-RED node provides an interface for communicating with the Garmin Lidar Lite v3 and Lidar Lite v3HP sensors over I2C. It allows you to easily trigger distance measurements, configure sensor parameters, and integrate lidar data into your Node-RED flows.

## Sensor Compatibility
* Garmin Lidar Lite v3
* Garmin Lidar Lite v3HP

_(This node is based on common register definitions for the Lidar Lite v3. Functionality with other Lidar Lite versions may vary.)_

---

## ✨ Features

-   **Distance Measurement:** Trigger single distance measurements or configure continuous interval-based readings.
-   **Configurable I2C Interface:** Specify I2C bus number and device address.
-   **Sensor Operating Modes:** Select from various pre-defined operating modes for different performance characteristics (e.g., balanced, short range/high speed, maximum range, high/low sensitivity).
-   **Dynamic I2C Address Configuration:**
    -   Set a new I2C address for the Lidar Lite sensor.
    -   Optionally disable the default I2C address (0x62).
-   **Unit Conversion:** Output distance readings in Centimeters (cm), Meters (m), Inches (in), or Feet (ft).
-   **Correlation Record Reading:** Access raw correlation data for advanced diagnostics or custom signal processing (optional).
-   **Robust Initialization:** Automatic retries (every 10 seconds) if sensor initialization fails.
-   **Status Reporting:** Node status indicates connection state and last measurement.

---

## 📦 Installation

You can install this node from the **Manage Palette** menu in Node-RED. Search for `node-red-contrib-lidar-lite-v3` (or a similar relevant package name).

Alternatively, install it from your Node-RED user directory (typically `~/.node-red`):

```sh
npm install node-red-contrib-lidar-lite-v3
```

_(Please replace_ `node-red-contrib-lidar-lite-v3` _with the actual npm package name if different.)_

After installation, restart Node-RED. The "lidar lite" node will then be available in the "sensors" category of your node palette.

---

## 🛠️ Node Configuration

The `lidar lite` node has several configuration properties that can be set in the Node-RED editor.

_(Conceptual image of the Node-RED configuration panel for this node)_

**Node Properties:**

*   **Name:** (Optional) A custom name for this node instance.
    *   _Default:_ `lidar lite`
*   **Bus Number:** The I2C bus number where the Lidar Lite is connected (e.g., `1` for `/dev/i2c-1`).
    *   _Input:_ `node-input-busno`
    *   _Default:_ `1`
    *   _Range:_ 0-7
*   **Device Address:** The I2C address of the Lidar Lite sensor. Can be entered in decimal (e.g., `98`) or hexadecimal (e.g., `0x62`).
    *   _Input:_ `node-input-address`
    *   _Default:_ `0x62`
*   **Mode:** Selects the operating mode of the Lidar Lite sensor.
    *   _Input:_ `node-input-mode`
    *   _Default:_ `0` (Default mode, balanced performance)
    *   _Options:_
        *   `0`: Default mode, balanced performance
        *   `1`: Short range, high speed
        *   `2`: Default range, higher speed short range
        *   `3`: Maximum range
        *   `4`: High sensitivity detection
        *   `5`: Low sensitivity detection
        *   `6`: Short range, high speed, higher error
*   **Set New Address:** (Optional) Specify a new I2C address (in hex or decimal) to assign to the Lidar Lite sensor. Leave blank to keep the current/default address.
    *   _Input:_ `node-input-newAddress`
    *   _Default:_ (empty)
*   **Disable Default Address:** (Checkbox) If setting a new address, check this to disable the original default address (0x62) on the sensor.
    *   _Input:_ `node-input-disableDefault`
    *   _Default:_ `false` (unchecked)
*   **Read Correlation Record:** (Checkbox) If checked, the node will also output the sensor's correlation record data in `msg.payload.correlation`.
    *   _Input:_ `node-input-readCorrelation`
    *   _Default:_ `false` (unchecked)
*   **Correlation Readings:** The number of correlation values to read if "Read Correlation Record" is enabled.
    *   _Input:_ `node-input-correlationReadings`
    *   _Default:_ `256`
    *   _Range:_ 1-1024
*   **Output Units:** Select the desired units for the distance measurement in `msg.payload.distance`.
    *   _Input:_ `node-input-units`
    *   _Default:_ `cm` (Centimeters)
    *   _Options:_ `cm`, `m`, `in`, `ft`
*   **Enable Interval Measurement:** (Checkbox) When checked, the node will automatically trigger measurements at the specified interval. If unchecked, the node only measures when it receives an input message.
    *   _Input:_ `node-input-intervalToggle`
    *   _Default:_ `false` (unchecked)
*   **Interval:** The numeric value for the measurement interval.
    *   _Input:_ `node-input-intervalValue`
    *   _Default:_ `1`
    *   _Min:_ `1`
*   **Interval Units:** The units for the measurement interval.
    *   _Input:_ `node-input-intervalUnits`
    *   _Default:_ `s` (Seconds)
    *   _Options:_ `Milliseconds`, `Seconds`, `Minutes`

---

## ⚙️ Inputs

*   **Any** `msg`**:**
    *   If "Enable Interval Measurement" is **unchecked**, an incoming message will trigger a distance measurement. The content of the `msg` is not used.
    *   If "Enable Interval Measurement" is **checked**, incoming messages are ignored.

---

## 📤 Outputs

1.  **Standard Output:**
    *   `msg.payload` (object):
        *   `distance` (number): The measured distance in the configured `Output Units`.
        *   `units` (string): The units of the `distance` measurement (e.g., "cm", "m", "in", "ft").
        *   `correlation` (array, optional): If "Read Correlation Record" is enabled, this property contains an array of correlation values. Each value is a signed number representing the correlation magnitude.

**Example** `msg.payload`**:**

```json
{
  "distance": 152.3,
  "units": "cm"
}
```

**Example** `msg.payload` **with Correlation Record:**

```json
{
  "distance": 75.1,
  "units": "in",
  "correlation": [50, 55, 60, ..., -10, -5]
}
```

---

## 🔗 Usage

1.  **Install the node** (see Installation section).
2.  **Drag the** `lidar lite` **node** from the palette onto your workspace.
3.  **Configure the node properties:**
    *   Set the correct **I2C Bus Number** and **Device Address**. The default address for Lidar Lite v3 is `0x62`.
    *   Choose your desired **Mode** and **Output Units**.
    *   (Optional) If you need to change the sensor's I2C address permanently, use the **Set New Address** and **Disable Default Address** options. **Caution:** Incorrectly changing the address can make the sensor unresponsive if you forget the new address.
    *   (Optional) Enable **Read Correlation Record** if you need diagnostic data.
4.  **Measurement Trigger:**
    *   **Manual Trigger:** Leave "Enable Interval Measurement" unchecked. Connect an `inject` node or any other node to its input. Each message sent to the `lidar lite` node will trigger one measurement.
    *   **Interval Trigger:** Check "Enable Interval Measurement" and set your desired **Interval** and **Interval Units**. The node will automatically take readings at this rate.
5.  **Connect a** `debug` **node** (or any other processing node) to the output of the `lidar lite` node to see the `msg.payload` containing the distance data.
6.  **Deploy** the flow.

### Error Handling & Status

*   The node will display its status:
    *   `initializing...` (yellow ring): Attempting to connect to the sensor.
    *   `connected` (green dot): Sensor initialized successfully.
    *   `dist: X.XX units` (green dot): Last successful measurement.
    *   `init error` (red ring): Initialization failed.
    *   `retry in 10s` (red ring): Will attempt to re-initialize in 10 seconds.
    *   `address error` (red ring): Failed to set a new I2C address.
    *   `meas. error` (yellow ring): An error occurred during a measurement attempt. If it's a communication error, it might attempt re-initialization.
*   Errors during initialization or measurement are logged to the Node-RED debug sidebar and potentially to the console.

---

## 🧑‍💻 Development & Contributions

*   This node relies on the `i2c-bus` npm package for I2C communication.
*   Feedback, bug reports, and contributions are welcome! Please open an issue or pull request on the project's GitHub repository (link to be added here).

---

## ☕ Support

If you find this Node-RED contribution useful, please consider supporting its development (if a support link is provided by the developer).

---

## 📚 License

Likely Apache-2.0 or MIT (please refer to the actual `LICENSE` file in the project repository).