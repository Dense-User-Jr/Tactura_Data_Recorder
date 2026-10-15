package com.gesturedatarecorder.recording

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.util.Log
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class RecordingService : Service(), SensorEventListener {
    companion object {
        const val ACTION_COMMAND = "com.gesturedatarecorder.RECORDING_COMMAND"
        const val ACTION_STATUS = "com.gesturedatarecorder.RECORDING_STATUS"
        const val EXTRA_COMMAND = "command"
        const val EXTRA_GESTURE = "gesture"
        const val EXTRA_PHASE = "phase"
        const val EXTRA_COUNTDOWN = "countdown"
        const val EXTRA_SAMPLES = "samples"
        const val EXTRA_FILE = "file"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_PREDICTION = "prediction"
        const val EXTRA_CONFIDENCE = "confidence"
        const val COMMAND_START = "start"
        const val COMMAND_CLASSIFY = "classify"
        const val COMMAND_CANCEL = "cancel"
        const val CHANNEL_ID = "recording_service"
        private const val NOTIFICATION_ID = 7
        private const val PREPARE_SECONDS = 3
        private const val CAPTURE_MS = 3_000L
        private const val CLASSIFY_WINDOW_MS = 3_500L

        fun start(context: Context, gesture: Gesture) {
            val intent = Intent(context, RecordingService::class.java).apply {
                action = ACTION_COMMAND
                putExtra(EXTRA_COMMAND, COMMAND_START)
                putExtra(EXTRA_GESTURE, gesture.name)
            }
            context.startForegroundService(intent)
        }

        fun cancel(context: Context) {
            val intent = Intent(context, RecordingService::class.java).apply {
                action = ACTION_COMMAND
                putExtra(EXTRA_COMMAND, COMMAND_CANCEL)
            }
            context.startForegroundService(intent)
        }

        fun classify(context: Context) {
            val intent = Intent(context, RecordingService::class.java).apply {
                action = ACTION_COMMAND
                putExtra(EXTRA_COMMAND, COMMAND_CLASSIFY)
            }
            context.startForegroundService(intent)
        }
    }

    private lateinit var sensorManager: SensorManager
    private var accelerometer: Sensor? = null
    private var gyroscope: Sensor? = null
    private lateinit var vibrator: android.os.Vibrator
    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())
    private var countdownJob: Job? = null
    private var selectedGesture: Gesture? = null
    private var phase = RecordingPhase.IDLE
    private var recordingStartNs = 0L
    private var recordingStartWallMs = 0L
    private var sampleCount = 0
    private var classificationInFlight = false
    private var lastClassificationMs = 0L
    private var classifier: OnWatchGestureClassifier? = null
    private var classifierError: String? = null
    private var classificationPrediction: GesturePrediction? = null
    private var latestAccel = floatArrayOf(0f, 0f, 0f)
    private var latestGyro = floatArrayOf(0f, 0f, 0f)
    private val csvRows = StringBuilder()

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Ready for a recording"))
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        gyroscope = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        vibrator = getSystemService(VIBRATOR_SERVICE) as android.os.Vibrator
        classifier = try {
            OnWatchGestureClassifier(assets)
        } catch (error: Exception) {
            classifierError = error.message ?: error.javaClass.simpleName
            Log.e("RecordingService", "Could not load gesture model", error)
            null
        }
        accelerometer?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        gyroscope?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.getStringExtra(EXTRA_COMMAND)) {
            COMMAND_START -> intent.getStringExtra(EXTRA_GESTURE)
                ?.let { runCatching { Gesture.valueOf(it) }.getOrNull() }
                ?.let(::beginCountdown)
            COMMAND_CLASSIFY -> beginClassification()
            COMMAND_CANCEL -> cancelRecording()
        }
        return START_STICKY
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (phase != RecordingPhase.RECORDING && phase != RecordingPhase.CLASSIFYING) return
        if (recordingStartNs == 0L) recordingStartNs = event.timestamp
        val values = event.values
        if (event.sensor.type == Sensor.TYPE_ACCELEROMETER) {
            latestAccel = values.copyOf()
            if (phase == RecordingPhase.CLASSIFYING) classifier?.addAccelerometer(event.timestamp / 1_000_000L, values)
        } else if (event.sensor.type == Sensor.TYPE_GYROSCOPE) {
            latestGyro = values.copyOf()
            if (phase == RecordingPhase.CLASSIFYING) classifier?.addGyroscope(event.timestamp / 1_000_000L, values)
        } else {
            return
        }

        if (phase == RecordingPhase.CLASSIFYING) {
            sampleCount++
            maybeClassify(event.timestamp / 1_000_000L)
            if (sampleCount % 20 == 0) broadcastStatus("Collecting sensor window", phase)
            return
        }

        val elapsedMs = (event.timestamp - recordingStartNs) / 1_000_000L
        csvRows.append(selectedGesture?.name.orEmpty()).append(',')
            .append(sampleCount++)
            .append(',').append(elapsedMs)
            .append(',').append(event.timestamp)
            .append(',').append(if (event.sensor.type == Sensor.TYPE_ACCELEROMETER) "accelerometer" else "gyroscope")
            .append(',').append(latestAccel[0]).append(',').append(latestAccel[1]).append(',').append(latestAccel[2])
            .append(',').append(latestGyro[0]).append(',').append(latestGyro[1]).append(',').append(latestGyro[2])
            .append('\n')
        if (sampleCount % 20 == 0) broadcastStatus("Recording", phase)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun beginCountdown(gesture: Gesture) {
        if (phase == RecordingPhase.COUNTDOWN || phase == RecordingPhase.RECORDING) return
        selectedGesture = gesture
        countdownJob?.cancel()
        countdownJob = scope.launch {
            phase = RecordingPhase.COUNTDOWN
            for (seconds in PREPARE_SECONDS downTo 1) {
                vibrate(60)
                broadcastStatus("Get ready", phase, seconds)
                delay(1_000)
            }
            startRecording()
        }
    }

    private fun startRecording() {
        phase = RecordingPhase.RECORDING
        sampleCount = 0
        recordingStartNs = 0L
        recordingStartWallMs = System.currentTimeMillis()
        latestAccel = floatArrayOf(0f, 0f, 0f)
        latestGyro = floatArrayOf(0f, 0f, 0f)
        csvRows.setLength(0)
        csvRows.append("gesture_label,sample_index,elapsed_ms,sensor_timestamp_ns,source_sensor,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z\n")
        vibrate(180)
        broadcastStatus("Move now", phase)
        countdownJob = scope.launch {
            delay(CAPTURE_MS)
            finishRecording()
        }
    }

    private fun beginClassification() {
        if (phase == RecordingPhase.COUNTDOWN || phase == RecordingPhase.RECORDING || phase == RecordingPhase.CLASSIFYING) return
        val activeClassifier = classifier
        if (activeClassifier == null) {
            broadcastStatus("Model unavailable: ${classifierError ?: "unknown error"}", RecordingPhase.ERROR)
            return
        }
        countdownJob?.cancel()
        selectedGesture = null
        sampleCount = 0
        recordingStartNs = 0L
        lastClassificationMs = 0L
        classificationInFlight = false
        classificationPrediction = null
        activeClassifier.reset()
        phase = RecordingPhase.CLASSIFYING
        vibrate(180)
        broadcastStatus("Move now; collecting 3 seconds", phase)
        countdownJob = scope.launch {
            delay(CLASSIFY_WINDOW_MS)
            finishClassification()
        }
    }

    private fun maybeClassify(timestampMs: Long) {
        if (classificationInFlight || timestampMs - lastClassificationMs < 500L) return
        val features = classifier?.featuresIfReady() ?: return
        classificationInFlight = true
        lastClassificationMs = timestampMs
        scope.launch(Dispatchers.Default) {
            runCatching { classifier?.predict(features) }
                .onSuccess { prediction ->
                    withContext(Dispatchers.Main.immediate) {
                        classificationInFlight = false
                        if (phase == RecordingPhase.CLASSIFYING && prediction != null) {
                            classificationPrediction = prediction
                            broadcastStatus(
                                "${prediction.label.replace('_', ' ')}  ${(prediction.confidence * 100).toInt()}%",
                                phase,
                                prediction = prediction.label,
                                confidence = prediction.confidence
                            )
                        }
                    }
                }
                .onFailure {
                    withContext(Dispatchers.Main.immediate) {
                        classificationInFlight = false
                        if (phase == RecordingPhase.CLASSIFYING) broadcastStatus("Classification failed", RecordingPhase.ERROR)
                    }
                }
        }
    }

    private fun finishClassification() {
        if (phase != RecordingPhase.CLASSIFYING) return
        phase = RecordingPhase.COMPLETE
        vibrateStopCue()
        val prediction = classificationPrediction
        if (prediction == null) {
            broadcastStatus("No prediction; collected $sampleCount samples", phase)
        } else {
            broadcastStatus(
                "Predicted ${prediction.label.replace('_', ' ')}  ${(prediction.confidence * 100).toInt()}%",
                phase,
                prediction = prediction.label,
                confidence = prediction.confidence
            )
        }
    }

    private fun finishRecording() {
        if (phase != RecordingPhase.RECORDING) return
        phase = RecordingPhase.SAVING
        vibrateStopCue()
        broadcastStatus("Saving ${sampleCount} samples", phase)
        scope.launch(Dispatchers.IO) {
            val fileName = saveCsv()
            launch(Dispatchers.Main) {
                if (fileName == null) {
                    phase = RecordingPhase.ERROR
                    broadcastStatus("Could not save CSV", phase)
                } else {
                    phase = RecordingPhase.COMPLETE
                    broadcastStatus("Saved $fileName", phase, file = fileName)
                }
            }
        }
    }

    private fun saveCsv(): String? {
        val gesture = selectedGesture ?: return null
        val recordingNumber = nextRecordingNumber()
        val fileName = "%04d_%s_".format(Locale.US, recordingNumber, gesture.name.lowercase(Locale.US)) +
            SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date(recordingStartWallMs)) + ".csv"
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, "text/csv")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/GestureDataRecorder")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
        }
        val resolver = contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
        return try {
            resolver.openOutputStream(uri)?.bufferedWriter()?.use { writer ->
                writer.write(csvRows.toString())
            } ?: return null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            }
            fileName
        } catch (_: Exception) {
            resolver.delete(uri, null, null)
            null
        }
    }

    private fun nextRecordingNumber(): Int {
        val recordingDirectory = Environment.DIRECTORY_DOWNLOADS + "/GestureDataRecorder/"
        val projection = arrayOf(MediaStore.Downloads.DISPLAY_NAME, MediaStore.Downloads.RELATIVE_PATH)
        var highestNumber = 0
        contentResolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            null
        )?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(MediaStore.Downloads.DISPLAY_NAME)
            val pathIndex = cursor.getColumnIndex(MediaStore.Downloads.RELATIVE_PATH)
            while (cursor.moveToNext()) {
                if (nameIndex < 0 || pathIndex < 0 || cursor.getString(pathIndex) != recordingDirectory) continue
                val name = cursor.getString(nameIndex)
                val number = name.substringBefore('_').toIntOrNull() ?: continue
                highestNumber = maxOf(highestNumber, number)
            }
        }
        return highestNumber + 1
    }

    private fun cancelRecording() {
        countdownJob?.cancel()
        classificationInFlight = false
        phase = RecordingPhase.IDLE
        broadcastStatus("Cancelled", phase)
    }

    private fun broadcastStatus(
        message: String,
        currentPhase: RecordingPhase,
        countdown: Int = 0,
        file: String? = null,
        prediction: String? = null,
        confidence: Float = 0f
    ) {
        val intent = Intent(ACTION_STATUS).apply {
            `package` = packageName
            putExtra(EXTRA_PHASE, currentPhase.name)
            putExtra(EXTRA_GESTURE, selectedGesture?.name)
            putExtra(EXTRA_COUNTDOWN, countdown)
            putExtra(EXTRA_SAMPLES, sampleCount)
            putExtra(EXTRA_FILE, file)
            putExtra(EXTRA_MESSAGE, message)
            putExtra(EXTRA_PREDICTION, prediction)
            putExtra(EXTRA_CONFIDENCE, confidence)
        }
        sendBroadcast(intent)
        startForeground(NOTIFICATION_ID, buildNotification(message))
    }

    private fun vibrate(durationMs: Long) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(android.os.VibrationEffect.createOneShot(durationMs, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION") vibrator.vibrate(durationMs)
        }
    }

    private fun vibrateStopCue() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(android.os.VibrationEffect.createWaveform(longArrayOf(0, 80, 100, 80), -1))
        } else {
            @Suppress("DEPRECATION") vibrator.vibrate(longArrayOf(0, 80, 100, 80), -1)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Gesture recordings", NotificationManager.IMPORTANCE_LOW)
            )
        }
    }

    private fun buildNotification(text: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Gesture Data Recorder")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_save)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    override fun onDestroy() {
        countdownJob?.cancel()
        scope.cancel()
        sensorManager.unregisterListener(this)
        classifier?.close()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
