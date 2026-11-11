package com.gesturedatarecorder.recording

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.gesturedatarecorder.ui.MainActivity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

/**
 * Foreground service that runs one session at a time: countdown, 3.0 s sensor capture, then
 * saving a labeled training CSV (Record), classifying the window and saving it as a diagnostics
 * CSV (Classify), or storing the window as one calibration rep (Calibrate). All modes capture
 * identically, so every model sees exactly the kind of window it learned from.
 *
 * The service lives only for the duration of a session. Sensors are registered only during a
 * session and deliver events on a background thread. State is published to [RecordingRepository].
 */
class RecordingService : Service(), SensorEventListener {
    companion object {
        private const val TAG = "RecordingService"
        private const val EXTRA_MODE = "mode"
        private const val EXTRA_GESTURE = "gesture"
        private const val CHANNEL_ID = "recording_service"
        private const val NOTIFICATION_ID = 7

        /** Capture timing. Training data depends on these; do not change casually. */
        const val PREPARE_SECONDS = 3
        const val CAPTURE_MS = 3_000L
        private const val PROGRESS_INTERVAL_MS = 250L

        fun startRecording(context: Context, gesture: Gesture) = start(context, SessionMode.RECORD, gesture)

        fun startClassification(context: Context) = start(context, SessionMode.CLASSIFY, null)

        /** Captures one calibration rep. With no [gesture], the next one that still needs reps is used. */
        fun startCalibration(context: Context, gesture: Gesture? = null) = start(context, SessionMode.CALIBRATE, gesture)

        private fun start(context: Context, mode: SessionMode, gesture: Gesture?) {
            if (RecordingRepository.status.value.phase.isBusy) return
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.BODY_SENSORS) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                RecordingRepository.reportError("Body Sensors permission is required")
                return
            }
            val intent = Intent(context, RecordingService::class.java)
                .putExtra(EXTRA_MODE, mode.name)
                .putExtra(EXTRA_GESTURE, gesture?.name)
            context.startForegroundService(intent)
        }
    }

    private lateinit var sensorManager: SensorManager
    private lateinit var notificationManager: NotificationManager
    private lateinit var vibrator: Vibrator
    private val sensorThread = HandlerThread("GestureSensors")
    private lateinit var sensorHandler: Handler
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var sessionJob: Job? = null
    private var lastStartId = 0
    private var lastNotifiedPhase: RecordingPhase? = null

    /** Non-null only while the capture window is open; written on main, read on the sensor thread. */
    @Volatile
    private var capture: SensorCapture? = null

    override fun onCreate() {
        super.onCreate()
        sensorManager = getSystemService(SensorManager::class.java)
        notificationManager = getSystemService(NotificationManager::class.java)
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            getSystemService(Vibrator::class.java)
        }
        sensorThread.start()
        sensorHandler = Handler(sensorThread.looper)
        notificationManager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Gesture sessions", NotificationManager.IMPORTANCE_LOW)
        )
        scope.launch { RecordingRepository.cancelRequests.collect { sessionJob?.cancel() } }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        lastStartId = startId
        // Every startForegroundService() must be answered with startForeground(), even if ignored.
        try {
            val text = RecordingRepository.status.value.takeIf { it.phase.isBusy }?.message ?: "Starting session"
            startForeground(NOTIFICATION_ID, buildNotification(text))
        } catch (error: Exception) {
            Log.e(TAG, "Could not enter the foreground", error)
            RecordingRepository.reportError("Could not start sensors: ${error.message ?: error.javaClass.simpleName}")
            stopSelfResult(startId)
            return START_NOT_STICKY
        }
        if (sessionJob?.isActive == true) return START_NOT_STICKY

        val mode = intent?.getStringExtra(EXTRA_MODE)?.let { runCatching { SessionMode.valueOf(it) }.getOrNull() }
        val gesture = Gesture.fromLabel(intent?.getStringExtra(EXTRA_GESTURE))
        if (mode == null || (mode == SessionMode.RECORD && gesture == null)) {
            // E.g. a system restart with no intent: nothing to do.
            endService()
            return START_NOT_STICKY
        }
        sessionJob = scope.launch { runSession(mode, gesture) }
        return START_NOT_STICKY
    }

    private suspend fun runSession(mode: SessionMode, gesture: Gesture?) = coroutineScope {
        val accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        val gyroscope = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        if (accelerometer == null || gyroscope == null) {
            publishError(if (accelerometer == null) "Accelerometer unavailable" else "Gyroscope unavailable")
            endService()
            return@coroutineScope
        }
        // Calibrate and Classify both need the user's saved calibration reps.
        if (mode != SessionMode.RECORD) withContext(Dispatchers.IO) { BlueprintStore.load(applicationContext) }
        val target = if (mode == SessionMode.CALIBRATE) gesture ?: BlueprintStore.nextToCalibrate() else gesture
        if (mode == SessionMode.CALIBRATE && target == null) {
            publishError("Every gesture is already calibrated")
            endService()
            return@coroutineScope
        }
        // Load the model during the countdown so it is ready when the window closes.
        val model = if (mode == SessionMode.CLASSIFY) {
            async { runCatching { ModelStore.get(applicationContext) } }
        } else {
            null
        }

        try {
            // Registering at countdown start lets the sensors warm up before the window opens.
            sensorManager.registerListener(this@RecordingService, accelerometer, SensorManager.SENSOR_DELAY_GAME, sensorHandler)
            sensorManager.registerListener(this@RecordingService, gyroscope, SensorManager.SENSOR_DELAY_GAME, sensorHandler)

            for (seconds in PREPARE_SECONDS downTo 1) {
                vibrate(60)
                publish { RecordingStatus(RecordingPhase.COUNTDOWN, mode, target, seconds, message = "Get ready", sessionTally = it.sessionTally) }
                delay(1_000)
            }

            val startedAtWallMs = System.currentTimeMillis()
            val startedAtMs = SystemClock.elapsedRealtime()
            val activeCapture = SensorCapture()
            capture = activeCapture
            vibrate(180)
            publish {
                it.copy(
                    phase = RecordingPhase.CAPTURING,
                    countdownSeconds = 0,
                    captureStartedAtMs = startedAtMs,
                    captureDurationMs = CAPTURE_MS,
                    message = "Move now"
                )
            }
            while (true) {
                val remaining = CAPTURE_MS - (SystemClock.elapsedRealtime() - startedAtMs)
                if (remaining <= 0) break
                delay(minOf(PROGRESS_INTERVAL_MS, remaining))
                publish { it.copy(sampleCount = activeCapture.size()) }
            }
            capture = null
            sensorManager.unregisterListener(this@RecordingService)
            vibrateStopCue()

            val events = activeCapture.snapshot()
            val metrics = SessionMetrics(
                accelerometerHz = events.rateHz(SensorKind.ACCELEROMETER),
                gyroscopeHz = events.rateHz(SensorKind.GYROSCOPE)
            )
            publish { it.copy(sampleCount = events.size, metrics = metrics) }
            if (events.none { it.kind == SensorKind.ACCELEROMETER } || events.none { it.kind == SensorKind.GYROSCOPE }) {
                publishError("No ${if (events.none { it.kind == SensorKind.GYROSCOPE }) "gyroscope" else "accelerometer"} data captured")
                return@coroutineScope
            }

            when (mode) {
                SessionMode.RECORD -> saveRecording(requireNotNull(target), events, startedAtWallMs)
                SessionMode.CLASSIFY -> classify(requireNotNull(model).await(), events, startedAtWallMs, metrics)
                SessionMode.CALIBRATE -> calibrate(requireNotNull(target), events, startedAtWallMs)
            }
        } catch (cancelled: CancellationException) {
            publish { RecordingStatus(RecordingPhase.IDLE, message = "Cancelled", sessionTally = it.sessionTally) }
            throw cancelled
        } finally {
            capture = null
            sensorManager.unregisterListener(this@RecordingService)
            endService()
        }
    }

    private suspend fun saveRecording(gesture: Gesture, events: List<SensorEventRecord>, startedAtWallMs: Long) {
        publish { it.copy(phase = RecordingPhase.SAVING, message = "Saving ${events.size} samples") }
        val fileName = withContext(Dispatchers.IO) {
            CsvStorage.save(
                applicationContext,
                CsvStorage.RECORDINGS_DIR,
                { number -> CsvStorage.recordingName(number, gesture, startedAtWallMs) },
                CaptureCsv.build(gesture.name, events)
            )
        }
        if (fileName == null) {
            publishError("Could not save CSV")
            return
        }
        Log.i(TAG, "Saved $fileName: ${events.size} events, metrics=${RecordingRepository.status.value.metrics}")
        publish {
            it.copy(
                phase = RecordingPhase.COMPLETE,
                fileName = fileName,
                message = "Saved",
                sessionTally = it.sessionTally + (gesture to (it.sessionTally[gesture] ?: 0) + 1)
            )
        }
    }

    private suspend fun classify(
        model: Result<Pair<ModelStore.Loaded, Boolean>>,
        events: List<SensorEventRecord>,
        startedAtWallMs: Long,
        captureMetrics: SessionMetrics
    ) {
        publish { it.copy(phase = RecordingPhase.CLASSIFYING, message = "Classifying") }
        // Once every gesture is calibrated, the user's own blueprints answer instead of the forest.
        if (BlueprintStore.isComplete()) {
            classifyWithBlueprints(model, events, startedAtWallMs, captureMetrics)
            return
        }
        val (loaded, loadedNow) = model.getOrElse { error ->
            Log.e(TAG, "Could not load gesture model", error)
            publishError("Model unavailable: ${error.message ?: error.javaClass.simpleName}")
            return
        }
        val features = GestureFeatures.extract(events) ?: run {
            publishError("Not enough sensor data to classify")
            return
        }
        val (prediction, inferenceMs) = try {
            withContext(Dispatchers.Default) {
                val started = SystemClock.elapsedRealtimeNanos()
                val result = loaded.classifier.predict(features)
                result to (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000f
            }
        } catch (error: Exception) {
            Log.e(TAG, "Classification failed", error)
            publishError("Classification failed: ${error.message ?: error.javaClass.simpleName}")
            return
        }
        val metrics = captureMetrics.copy(inferenceMs = inferenceMs, modelLoadMs = if (loadedNow) loaded.loadMs else null)

        // Keep the exact classified window so it can be re-run through the .joblib on a PC.
        val fileName = withContext(Dispatchers.IO) {
            CsvStorage.save(
                applicationContext,
                CsvStorage.CLASSIFY_DIR,
                { number -> CsvStorage.classifyName(number, prediction, startedAtWallMs) },
                CaptureCsv.build(prediction.label, events)
            )
        }
        Log.i(
            TAG,
            "Predicted ${prediction.label} %.3f in %.2f ms (load ${metrics.modelLoadMs} ms), file=$fileName, metrics=$metrics"
                .format(Locale.US, prediction.confidence, inferenceMs)
        )
        publish {
            it.copy(
                phase = RecordingPhase.COMPLETE,
                prediction = prediction,
                source = PredictionSource.FOREST,
                metrics = metrics,
                fileName = fileName,
                message = if (fileName == null) "Diagnostics CSV not saved" else "Classified"
            )
        }
    }

    /**
     * Classify with the user's blueprints: find the action, crop around it, and pick the closest
     * blueprint, or decide that no known gesture happened. The forest's answer is only logged, so
     * the two can be compared later.
     */
    private suspend fun classifyWithBlueprints(
        model: Result<Pair<ModelStore.Loaded, Boolean>>,
        events: List<SensorEventRecord>,
        startedAtWallMs: Long,
        captureMetrics: SessionMetrics
    ) {
        val started = SystemClock.elapsedRealtimeNanos()
        val (extraction, match) = withContext(Dispatchers.Default) {
            val found = MotionClip.extract(events)
            found to GestureBlueprints.classify(found.clip, BlueprintStore.blueprints())
        }
        val inferenceMs = (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000f
        val forest = withContext(Dispatchers.Default) {
            val classifier = model.getOrNull()?.first?.classifier
            val features = GestureFeatures.extract(events)
            if (classifier == null || features == null) null else runCatching { classifier.predict(features) }.getOrNull()
        }

        // "Match" is how close the clip came, as a share of the gesture's own size: 100% is a perfect fit.
        val prediction = match.gesture?.let { name ->
            val size = BlueprintStore.blueprints().getValue(name).size
            GesturePrediction(name, (1.0 - match.distance / size).coerceIn(0.0, 1.0).toFloat())
        }
        val message = when {
            prediction != null -> "Classified"
            extraction.clip == null -> "Wrist stayed still"
            else -> "Did not match a blueprint"
        }
        val metrics = captureMetrics.copy(inferenceMs = inferenceMs)

        val fileName = withContext(Dispatchers.IO) {
            CsvStorage.save(
                applicationContext,
                CsvStorage.CLASSIFY_DIR,
                { number ->
                    if (prediction != null) CsvStorage.classifyName(number, prediction, startedAtWallMs)
                    else CsvStorage.classifyNoneName(number, startedAtWallMs)
                },
                CaptureCsv.build(prediction?.label ?: "NONE", events)
            )
        }
        Log.i(
            TAG,
            "Blueprints: ${prediction?.label ?: "NONE"} distance=${match.distance} peak=${extraction.peakLevel} " +
                "in $inferenceMs ms; forest said ${forest?.label} ${forest?.confidence}; file=$fileName"
        )
        publish {
            it.copy(
                phase = RecordingPhase.COMPLETE,
                prediction = prediction,
                noGesture = prediction == null,
                source = PredictionSource.BLUEPRINTS,
                metrics = metrics,
                fileName = fileName,
                message = message
            )
        }
    }

    /**
     * Calibrate: turn the window into a clip and keep it as one rep of [gesture]. A window where
     * the wrist never moved enough is not counted. The raw window is also saved as a CSV labeled
     * with the gesture the user was asked to do.
     */
    private suspend fun calibrate(gesture: Gesture, events: List<SensorEventRecord>, startedAtWallMs: Long) {
        publish { it.copy(phase = RecordingPhase.SAVING, message = "Checking the rep") }
        val clip = withContext(Dispatchers.Default) { MotionClip.extract(events).clip }
        if (clip == null) {
            publish {
                it.copy(
                    phase = RecordingPhase.COMPLETE,
                    repCounted = false,
                    repNumber = BlueprintStore.reps(gesture),
                    repsNeeded = BlueprintStore.REPS_NEEDED,
                    message = "Didn't catch that. Try a bigger move."
                )
            }
            return
        }
        val (fileName, added) = withContext(Dispatchers.IO) {
            val name = CsvStorage.save(
                applicationContext,
                CsvStorage.CALIBRATION_DIR,
                { number -> CsvStorage.calibrationName(number, gesture, startedAtWallMs) },
                CaptureCsv.build(gesture.name, events)
            )
            name to BlueprintStore.addRep(applicationContext, gesture, clip)
        }
        Log.i(
            TAG,
            "Calibration ${gesture.name}: ${added.count} of ${BlueprintStore.REPS_NEEDED} reps, " +
                "dropped=${added.dropped}, inconsistent=${added.inconsistent}, file=$fileName"
        )
        val message = when {
            added.dropped -> "One rep didn't match the others, so it was dropped. Do one more, the same way each time."
            added.inconsistent -> "Saved, but these reps differ a lot. It may not be recognised. Redo it later."
            fileName == null -> "Rep counted, CSV not saved"
            else -> "Saved"
        }
        publish {
            it.copy(
                phase = RecordingPhase.COMPLETE,
                repCounted = true,
                repNumber = added.count,
                repsNeeded = BlueprintStore.REPS_NEEDED,
                fileName = fileName,
                message = message
            )
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        val activeCapture = capture ?: return
        val kind = when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> SensorKind.ACCELEROMETER
            Sensor.TYPE_GYROSCOPE -> SensorKind.GYROSCOPE
            else -> return
        }
        val values = event.values
        activeCapture.add(SensorEventRecord(kind, event.timestamp, values[0], values[1], values[2]))
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun publish(transform: (RecordingStatus) -> RecordingStatus) {
        RecordingRepository.update(transform)
        val status = RecordingRepository.status.value
        if (status.phase != lastNotifiedPhase) {
            lastNotifiedPhase = status.phase
            notificationManager.notify(NOTIFICATION_ID, buildNotification(status.message))
        }
    }

    private fun publishError(message: String) = publish {
        it.copy(phase = RecordingPhase.ERROR, message = message)
    }

    /** Leaves the foreground and stops, unless a newer start command has arrived meanwhile. */
    private fun endService() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelfResult(lastStartId)
    }

    private fun vibrate(durationMs: Long) {
        vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    private fun vibrateStopCue() {
        vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 80, 100, 80), -1))
    }

    private fun buildNotification(text: String): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Gesture Data Recorder")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_save)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        sessionJob?.cancel()
        scope.cancel()
        capture = null
        sensorManager.unregisterListener(this)
        sensorThread.quitSafely()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
