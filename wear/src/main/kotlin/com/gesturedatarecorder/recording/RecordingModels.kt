package com.gesturedatarecorder.recording

/**
 * The six Tactura gestures. [name] is the label written to CSVs and used by the
 * training script (ML/train_gesture_classifier.py SUPPORTED_LABELS); keep them identical.
 */
enum class Gesture(val displayName: String, val phonemes: String) {
    // The phoneme bins come from the team's "Gesture-to-Phoneme Bin Assignment" (ARPAbet).
    FLICK_UP("Flick Up", "TH/DH"),
    FLICK_DOWN("Flick Down", "P/B"),
    TWIST_RIGHT("Twist Right", "IY/UH"),
    TWIST_LEFT("Twist Left", "IH/UW"),
    SHAKE("Shake", "S/Z"),
    DOUBLE_TAP("Double Tap", "CH/JH");

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
    CLASSIFY,

    /** Capture one rep of a gesture for the user's blueprints, and save it as a labeled CSV. */
    CALIBRATE,

    /** No button: keep listening and name each gesture as it happens, until stopped. */
    LISTEN
}

enum class RecordingPhase {
    IDLE,
    COUNTDOWN,
    CAPTURING,
    LISTENING,
    CLASSIFYING,
    SAVING,
    COMPLETE,
    ERROR;

    val isBusy: Boolean
        get() = this == COUNTDOWN || this == CAPTURING || this == LISTENING || this == CLASSIFYING || this == SAVING
}

data class GesturePrediction(val label: String, val confidence: Float) {
    val displayName: String
        get() = Gesture.fromLabel(label)?.displayName ?: label.replace('_', ' ')
}

/** Which model answered a Classify session. */
enum class PredictionSource {
    /** The user's own calibrated blueprints (GestureBlueprints). */
    BLUEPRINTS,

    /** The bundled random forest (OnWatchGestureClassifier), used until calibration is complete. */
    FOREST
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
    /** Which model produced [prediction], or decided there was no gesture. */
    val source: PredictionSource? = null,
    /** Classify with blueprints concluded that no known gesture happened. */
    val noGesture: Boolean = false,
    /** Calibrate: whether this rep was accepted. */
    val repCounted: Boolean = false,
    /** Calibrate: how many reps [gesture] now has, out of [repsNeeded]. */
    val repNumber: Int = 0,
    val repsNeeded: Int = 0,
    /** Listen: labels of the gestures of the word being spelled, newest last. Emptied when a word is chosen. */
    val heard: List<String> = emptyList(),
    /** Listen: the words the gestures so far spell exactly, most common first. */
    val words: List<String> = emptyList(),
    /** Listen: the words that start with the gestures so far and need more, most common first. */
    val wordHints: List<String> = emptyList(),
    /** Listen: the last word the user chose, or null when there is none yet. */
    val word: String? = null,
    /** Listen: how many words have been chosen in this session. */
    val wordCount: Int = 0,
    /** Listen: how many gestures have been named in this session. */
    val heardCount: Int = 0,
    /** Listen: how many bursts of movement were not a gesture. */
    val ignoredCount: Int = 0,
    val metrics: SessionMetrics = SessionMetrics(),
    val message: String = "",
    /** Recordings saved per gesture since the app process started. */
    val sessionTally: Map<Gesture, Int> = emptyMap()
)
