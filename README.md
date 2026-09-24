# GestureDataRecorder

A Wear OS data-collection app for training a gesture-classification model. It records accelerometer and gyroscope samples for one of the six gestures used by GestureComm:

- Flick Up
- Flick Down
- Twist Right
- Twist Left
- Shake
- Double Tap

The app does not classify the movement. The selected gesture is stored as the training label in the filename and in every CSV row; the user performs the gesture during the capture window.

## Requirements

- A Wear OS watch with accelerometer and gyroscope sensors. The app was tested with a Pixel Watch 2.
- Android Studio with this project opened as the Gradle project.
- Android SDK Platform 34 and a Java 17 runtime, as required by the Gradle configuration.
- A working Android Debug Bridge (`adb`) connection to the watch.
- Body Sensors permission granted to the app.

## Build the debug APK

From the repository root, run the Gradle wrapper.

On Windows PowerShell:

```powershell
.\gradlew.bat :wear:assembleDebug
```

The APK is created at:

```text
wear\build\outputs\apk\debug\wear-debug.apk
```

## Install on a Wear OS watch

### Enable debugging on the watch

The exact menu names vary slightly by Wear OS version, but the process is:

1. Open **Settings > System > About** on the watch.
2. Tap **Build number** repeatedly until Developer options are enabled.
3. Open **Settings > Developer options**.
4. Enable **ADB debugging**.
5. Enable **Wireless debugging** if you are connecting over Wi-Fi.

Keep the watch and computer on the same network for wireless debugging. If the watch displays a pairing code or address, complete pairing from the computer before trying to install.

### Verify the ADB connection

Run:

```powershell
adb devices
```

The watch should appear with a device or `tcpip` serial. If it appears as `unauthorized`, accept the debugging prompt on the watch and run the command again. If no device appears, check that debugging is enabled and reconnect with the watch's wireless-debugging address.

If more than one device is listed, save the watch serial and use `adb -s WATCH_SERIAL` in the commands below.

### Install the APK

Install or update the debug build with:

```powershell
adb install -r .\wear\build\outputs\apk\debug\wear-debug.apk
```

Alternatively, open the project in Android Studio, select the `wear` run configuration, select the connected watch, and click **Run**. Android Studio builds, installs, and launches the app for you.

## Record a gesture

1. Open **Gesture Data Recorder** on the watch.
2. Grant the requested **Body Sensors** permission. Recording is disabled until this permission is granted.
3. Scroll the screen if necessary. Select one of the six gesture labels.
4. Tap **Record**.
5. The watch vibrates once for each second of a 3-second preparation countdown. Do not perform the gesture yet.
6. A stronger vibration marks the beginning of the 3-second capture window. Perform the selected gesture during this window.
7. A double vibration marks the end of capture.
8. Wait for the status to change to **Saved** before starting another recording.

Each recording is saved as a separate CSV in the watch's shared storage at:

```text
/sdcard/Download/GestureDataRecorder
```

Filenames use the selected label in lowercase followed by a timestamp, for example:

```text
twist_right_20260924_194114.csv
```

To stop a countdown or recording early, tap **Cancel**. A cancelled recording is not saved.

For training data, use the same watch position, orientation, gesture definition, and capture timing for every label. Record multiple examples per gesture and include examples from different sessions so the model does not learn one accidental motion or one exact starting pose.

## Pull CSV files off the watch

First confirm that the watch is connected:

```powershell
adb devices
```

List the files on the watch:

```powershell
adb shell ls -l /sdcard/Download/GestureDataRecorder
```

From the repository root, copy all recordings into a local `recordings` folder:

```powershell
adb pull /sdcard/Download/GestureDataRecorder .\recordings
```

You can pull one file instead:

```powershell
adb pull /sdcard/Download/GestureDataRecorder/twist_right_20260924_194114.csv .\recordings\
```

The local `recordings` folder is not created by source control; create it first if needed:

```powershell
New-Item -ItemType Directory -Force .\recordings
```

### Clear recordings from the watch

After confirming that the files were copied, delete only the CSV files from the watch with:

```powershell
adb shell "rm -f /sdcard/Download/GestureDataRecorder/*.csv"
adb shell ls /sdcard/Download/GestureDataRecorder
```

The second command should print no CSV filenames. This leaves the app and its recording folder in place.

## Interpret the CSV

The header is:

```text
gesture_label,sample_index,elapsed_ms,sensor_timestamp_ns,source_sensor,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z
```

| Column | Meaning |
| --- | --- |
| `gesture_label` | The selected training label, such as `TWIST_RIGHT`. |
| `sample_index` | Zero-based row number across both sensors. It is not an accelerometer-only or gyroscope-only index. |
| `elapsed_ms` | Milliseconds since the first sensor event in the capture. |
| `sensor_timestamp_ns` | Android's monotonic sensor timestamp in nanoseconds. Use this for chronological ordering. |
| `source_sensor` | The sensor that produced the new event: `accelerometer` or `gyroscope`. |
| `accel_x`, `accel_y`, `accel_z` | Accelerometer values, normally in meters per second squared (`m/s^2`). |
| `gyro_x`, `gyro_y`, `gyro_z` | Gyroscope values, normally in radians per second (`rad/s`). |

Every sensor event creates one row. Because the accelerometer and gyroscope do not necessarily report at exactly the same instant, the row contains the newest available values from the other sensor. For example, an accelerometer row has fresh acceleration values and repeats the most recent gyroscope values. Initial values for a sensor can therefore be `0.0` until its first event arrives.

### Important processing details

- Do not assume the physical CSV row order is chronological. Sensor callbacks can arrive interleaved, so `elapsed_ms` can decrease between adjacent rows. Sort by `sensor_timestamp_ns` before plotting or feature extraction.
- `sensor_timestamp_ns` is monotonic device time, not a wall-clock date. The filename timestamp is the wall-clock time used to identify the recording.
- The accelerometer includes gravity. A stationary watch will usually show approximately `9.8 m/s^2` on the axis aligned with gravity.
- Larger gyroscope magnitudes indicate faster rotation. Large changes in acceleration indicate translation, impact, or a change in watch orientation.
- The file contains raw sensor streams, not a model prediction or a quality score. Inspect for missing intervals, implausible spikes, and whether the intended movement appears during the 3-second window.

For example, a twist recording may show elevated gyroscope values during the movement and then values returning closer to zero as the watch stabilizes. The exact axis and sign depend on how the watch is worn and on the direction of the movement.
