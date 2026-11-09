# GestureDataRecorder

A Wear OS data-collection app for training a gesture-classification model. It records accelerometer and gyroscope samples for one of the six gestures used by GestureComm:

- Flick Up
- Flick Down
- Twist Right
- Twist Left
- Shake
- Double Tap

The app can record labeled sensor data and classify gestures directly on the watch. The selected gesture is stored as the training label in the filename and in every CSV row; the user performs the gesture during the capture window.

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

### Option 1: Install through Android Studio

1. Open the repository root in Android Studio. If prompted, allow Gradle to sync the project and install any missing SDK components.
2. Enable ADB debugging on the watch using the steps above, then connect the watch over USB or pair it through Wireless debugging.
3. In the Android Studio device selector, choose the connected Wear OS watch.
4. Select the `wear` run configuration.
5. Click **Run**. Android Studio builds the debug APK, installs it on the watch, and launches the app.
6. On the watch, grant **Body Sensors** permission when the app requests it.

If the watch is not listed, confirm that it appears in Android Studio's **Device Manager** or run `adb devices` in the terminal. Accept any debugging authorization prompt shown on the watch.

### Option 2: Install the APK with ADB

Install or update the debug build with:

```powershell
adb install -r .\wear\build\outputs\apk\debug\wear-debug.apk
```

After installation, open **Gesture Data Recorder** on the watch and grant **Body Sensors** permission when prompted.

## Record a gesture

1. Open **Gesture Data Recorder** on the watch.
2. Grant the requested **Body Sensors** permission. Recording is disabled until this permission is granted. If it was denied, tap **Grant permission** (or **Open Settings** if the system no longer shows the prompt) on the home screen.
3. Scroll with the crown or by swiping, and select one of the six gestures under **Gesture to record**. The **Record** chip shows the selected gesture.
4. Tap **Record**.
5. The watch vibrates once for each second of a 3-second preparation countdown. Do not perform the gesture yet.
6. A stronger vibration marks the beginning of the 3-second capture window, and a ring fills around the screen edge. Perform the selected gesture during this window.
7. A double vibration marks the end of capture.
8. The result screen shows the saved file name, the sample count and the measured sensor rates. Tap **Record again** to record the same gesture again, or **Done** to return to the list. Each gesture in the list shows how many recordings you've saved this session.

Each recording is saved as a separate CSV in the watch's shared storage at:

```text
/sdcard/Download/GestureDataRecorder
```

Filenames begin with a persistent recording number, followed by the selected label and a timestamp. For example:

```text
0007_twist_right_20260924_194114.csv
```

The number is based on the highest numbered CSV currently in the watch folder, which makes files easy to identify and sort. If the folder is emptied, the next recording starts at `0001`. If numbered files remain, the next recording uses the next highest number.

To stop a countdown or recording early, tap **Cancel** or press the back button. Leaving the app also cancels. A cancelled recording is not saved.

For training data, use the same watch position, orientation, gesture definition, and capture timing for every label. Record multiple examples per gesture and include examples from different sessions so the model does not learn one accidental motion or one exact starting pose.

## Classify gestures on the watch

The app includes a fully watch-native **Classify** mode. It does not require a phone, computer, network connection, or Python runtime while running. Classify captures exactly like Record (the same 3-second countdown and 3-second window), so the model sees the same kind of window it was trained on. It then extracts the same 192 features as the training script and runs the bundled ONNX model on the watch. The Kotlin feature code is checked against the Python code by a unit test (see [Feature parity test](#feature-parity-test)).

To use it:

1. Open **Gesture Data Recorder** and grant **Body Sensors** permission.
2. Tap **Classify**.
3. Wait through the 3-second countdown, then perform one gesture after the strong vibration, during the 3-second window.
4. After the double vibration, read the predicted gesture, its confidence, the inference time and the measured sensor rates. The first Classify after the app starts also shows how long the model took to load.
5. Tap **Classify again** or **Done**. Tap **Cancel** only if you need to stop early.

Each classified window is also saved, in the same CSV format, to a separate folder for diagnostics:

```text
/sdcard/Download/GestureClassify/0003_classify_pred-twist_left-87_20261108_201500.csv
```

The name holds the predicted label and confidence percentage; the `gesture_label` column holds the predicted label, **not** the true gesture. Never copy these files into the training folder. Their purpose is to re-run the exact window through the `.joblib` model on a PC and compare its answer with the watch's ONNX answer:

```powershell
adb pull /sdcard/Download/GestureClassify .\classify_logs
```

The current model recognizes the five classes represented in the training data: Flick Up, Flick Down, Twist Right, Twist Left, and Shake. Double Tap is not recognized until examples are collected and the model is retrained.

The deployed model is `wear/src/main/assets/gesture_random_forest.onnx`. The Python `.joblib` file remains the training artifact and is not loaded by the watch.

### Export a refreshed watch model

After collecting additional CSVs and retraining the Random Forest, install the ML requirements and export the model:

```powershell
python -m pip install -r .\ML\requirements.txt
python .\ML\train_gesture_classifier.py
python .\ML\export_gesture_model.py
```

The export script writes the deployable ONNX file to `wear/src/main/assets`. Rebuild and reinstall the APK after exporting:

```powershell
.\gradlew.bat :wear:assembleDebug
adb install -r .\wear\build\outputs\apk\debug\wear-debug.apk
```

If the set of trained classes changes (for example, when Double Tap is added), also update `MODEL_LABELS` in `wear/src/main/kotlin/com/gesturedatarecorder/recording/OnWatchGestureClassifier.kt` to match `model.classes_` (alphabetical). The app shows an error at model load if the counts don't match.

### Feature parity test

The watch computes features with a Kotlin port (`GestureFeatures.kt`) of `recording_features()` in `ML/train_gesture_classifier.py`. A JVM unit test checks that both produce identical values on real recordings, and that the watch's CSV writer reproduces existing recordings byte for byte:

```powershell
.\gradlew.bat :wear:testDebugUnitTest
```

If you change `recording_features()`, port the change to `GestureFeatures.kt`, then regenerate the reference values and re-run the test:

```powershell
python .\ML\dump_reference_features.py
.\gradlew.bat :wear:testDebugUnitTest
```

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

## Plot sensor recordings

The plotting utility is in `Accessory Software/sensor_gesture_plot.py`. Run it from the repository root after pulling recordings. With no input files, it automatically reads every `.csv` in:

```text
recordings/GestureDataRecorder
```

By default, it writes a new graph to the `Graphs` directory. The first graph is named:

```text
Accessory Software/Graphs/composite_sensors.png
```

If that file already exists, the script automatically uses a numbered name such as `composite_sensors_001.png`, then `composite_sensors_002.png`, so previous graphs are not overwritten.

Run the default workflow with:

```powershell
python ".\Accessory Software\sensor_gesture_plot.py"
```

The `Graphs` directory is created automatically if it does not exist. To plot selected files instead, pass their paths:

```powershell
python ".\Accessory Software\sensor_gesture_plot.py" `
	".\recordings\GestureDataRecorder\0007_twist_right_20260924_194114.csv"
```

To choose a different output file, use `-o` or `--output`. An explicitly supplied output path is used as-is:

```powershell
python ".\Accessory Software\sensor_gesture_plot.py" `
	".\recordings\GestureDataRecorder\0007_twist_right_20260924_194114.csv" `
	-o ".\Accessory Software\Graphs\twist_right_0007.png"
```

The utility produces accelerometer and gyroscope plots for the available channels. It aligns recordings on peak gyroscope magnitude by default and prints the number of recordings included in each plotted group.

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
