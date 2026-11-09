package com.gesturedatarecorder.recording

/**
 * The six Tactura gestures. [name] is the label written to CSVs and used by the
 * training script (ML/train_gesture_classifier.py SUPPORTED_LABELS); keep them identical.
 */
enum class Gesture(val displayName: String) {
    FLICK_UP("Flick Up"),
    FLICK_DOWN("Flick Down"),
    TWIST_RIGHT("Twist Right"),
    TWIST_LEFT("Twist Left"),
    SHAKE("Shake"),
    DOUBLE_TAP("Double Tap");

    companion object {
        fun fromLabel(label: String?): Gesture? =
            entries.firstOrNull { it.name.equals(label?.trim(), ignoreCase = true) }
    }
}

/** What a session does once the capture window ends. */
enum class SessionMode {
    /** Save the capture as a labeled training CSV. */
    RECORD,

    /** Classify the capture with the on-watch model and save it as a diagnostics CSV. */
    CLASSIFY
}

enum class RecordingPhase {
    IDLE,
    COUNTDOWN,
    CAPTURING,
    CLASSIFYING,
    SAVING,
    COMPLETE,
    ERROR;

    val isBusy: Boolean
        get() = this == COUNTDOWN || this == CAPTURING || this == CLASSIFYING || this == SAVING
}

data class GesturePrediction(val label: String, val confidence: Float) {
    val displayName: String
        get() = Gesture.fromLabel(label)?.displayName ?: label.replace('_', ' ')
}

/** Measurements gathered during a session, for feasibility diagnostics. */
data class SessionMetrics(
    val accelerometerHz: Float = 0f,
    val gyroscopeHz: Float = 0f,
    val inferenceMs: Float? = null,
    val modelLoadMs: Long? = null
)

/** Single source of truth for the UI, published by [RecordingRepository]. */
data class RecordingStatus(
    val phase: RecordingPhase = RecordingPhase.IDLE,
    val mode: SessionMode? = null,
    val gesture: Gesture? = null,
    val countdownSeconds: Int = 0,
    /** `SystemClock.elapsedRealtime()` when the capture window opened; 0 when not capturing. */
    val captureStartedAtMs: Long = 0L,
    val captureDurationMs: Long = 0L,
    val sampleCount: Int = 0,
    val fileName: String? = null,
    val prediction: GesturePrediction? = null,
    val metrics: SessionMetrics = SessionMetrics(),
    val message: String = "",
    /** Recordings saved per gesture since the app process started. */
    val sessionTally: Map<Gesture, Int> = emptyMap()
)
