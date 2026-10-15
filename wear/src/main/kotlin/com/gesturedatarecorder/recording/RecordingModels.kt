package com.gesturedatarecorder.recording

enum class Gesture(val displayName: String) {
    FLICK_UP("Flick Up"),
    FLICK_DOWN("Flick Down"),
    TWIST_RIGHT("Twist Right"),
    TWIST_LEFT("Twist Left"),
    SHAKE("Shake"),
    DOUBLE_TAP("Double Tap")
}

enum class RecordingPhase {
    IDLE,
    COUNTDOWN,
    RECORDING,
    CLASSIFYING,
    SAVING,
    COMPLETE,
    ERROR
}

data class RecordingStatus(
    val phase: RecordingPhase = RecordingPhase.IDLE,
    val gesture: Gesture? = null,
    val countdownSeconds: Int = 0,
    val sampleCount: Int = 0,
    val fileName: String? = null,
    val message: String = "Select a gesture"
)
