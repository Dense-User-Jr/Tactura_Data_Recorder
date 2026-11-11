package com.gesturedatarecorder.ui

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import com.gesturedatarecorder.recording.BlueprintStore
import com.gesturedatarecorder.recording.Gesture
import com.gesturedatarecorder.recording.PredictionSource
import com.gesturedatarecorder.recording.RecordingPhase
import com.gesturedatarecorder.recording.RecordingRepository
import com.gesturedatarecorder.recording.RecordingService
import com.gesturedatarecorder.recording.RecordingStatus
import com.gesturedatarecorder.recording.SessionMetrics
import com.gesturedatarecorder.recording.SessionMode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

// Colors, fonts and the building blocks (Label, Readout, TacturaButton, ...) live in TacturaTheme.kt.

private enum class Screen { HOME, COUNTDOWN, CAPTURE, WORKING, RESULT, ERROR }

private fun RecordingPhase.screen(): Screen = when (this) {
    RecordingPhase.IDLE -> Screen.HOME
    RecordingPhase.COUNTDOWN -> Screen.COUNTDOWN
    RecordingPhase.CAPTURING -> Screen.CAPTURE
    RecordingPhase.CLASSIFYING, RecordingPhase.SAVING -> Screen.WORKING
    RecordingPhase.COMPLETE -> Screen.RESULT
    RecordingPhase.ERROR -> Screen.ERROR
}

@Composable
fun RecorderApp(permission: SensorPermission, onPermissionAction: () -> Unit) {
    val status by RecordingRepository.status.collectAsState()
    var selectedGesture by rememberSaveable { mutableStateOf(Gesture.FLICK_UP) }
    val context = LocalContext.current
    val canStart = permission == SensorPermission.GRANTED
    val scope = rememberCoroutineScope()

    // Reps saved per gesture. Loaded once from the watch's storage, then kept current by the store.
    val calibration by BlueprintStore.progress.collectAsState()
    LaunchedEffect(Unit) { withContext(Dispatchers.IO) { BlueprintStore.load(context.applicationContext) } }
    val nextToCalibrate = BlueprintStore.GESTURES.firstOrNull { (calibration[it] ?: 0) < BlueprintStore.REPS_NEEDED }

    // Keep the screen awake while the app is open. Without this the watch reads a flick or a
    // lowered wrist as "done looking" and swaps the app for a blurred picture with the clock on it.
    val view = LocalView.current
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }

    // Back cancels a running session or dismisses a result instead of leaving the app.
    BackHandler(enabled = status.phase.isBusy) { RecordingRepository.requestCancel() }
    BackHandler(enabled = status.phase == RecordingPhase.COMPLETE || status.phase == RecordingPhase.ERROR) {
        RecordingRepository.dismissResult()
    }

    TacturaTheme {
        AnimatedContent(
            targetState = status,
            contentKey = { it.phase.screen() },
            transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) },
            label = "screen"
        ) { shown ->
            when (shown.phase.screen()) {
                Screen.HOME -> HomeScreen(
                    status = shown,
                    selectedGesture = selectedGesture,
                    onSelectGesture = { selectedGesture = it },
                    permission = permission,
                    onPermissionAction = onPermissionAction,
                    onRecord = { RecordingService.startRecording(context, selectedGesture) },
                    onClassify = { RecordingService.startClassification(context) },
                    canStart = canStart,
                    calibration = calibration,
                    nextToCalibrate = nextToCalibrate,
                    onCalibrate = { RecordingService.startCalibration(context) },
                    onResetCalibration = {
                        scope.launch(Dispatchers.IO) { BlueprintStore.clear(context.applicationContext) }
                    },
                    onRedoGesture = { gesture ->
                        scope.launch(Dispatchers.IO) { BlueprintStore.clear(context.applicationContext, gesture) }
                    }
                )
                Screen.COUNTDOWN -> CountdownScreen(shown)
                Screen.CAPTURE -> CaptureScreen(shown)
                Screen.WORKING -> WorkingScreen(shown)
                Screen.RESULT -> ResultScreen(
                    status = shown,
                    calibrationDone = nextToCalibrate == null,
                    onAgain = {
                        when (shown.mode) {
                            SessionMode.CLASSIFY -> RecordingService.startClassification(context)
                            SessionMode.CALIBRATE -> RecordingService.startCalibration(context)
                            else -> RecordingService.startRecording(context, shown.gesture ?: selectedGesture)
                        }
                    },
                    onDone = RecordingRepository::dismissResult
                )
                Screen.ERROR -> ErrorScreen(shown.message, onDismiss = RecordingRepository::dismissResult)
            }
        }
    }
}

// ---------------------------------------------------------------- scrolling lists

/** ScalingLazyColumn with TimeText, a position indicator and crown (rotary) scrolling. */
@Composable
private fun ScrollingScreen(
    state: ScalingLazyListState = rememberScalingLazyListState(),
    content: ScalingLazyListScope.() -> Unit
) {
    val focusRequester = remember { FocusRequester() }
    val scope = rememberCoroutineScope()
    Scaffold(
        timeText = { TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
        positionIndicator = { PositionIndicator(scalingLazyListState = state) }
    ) {
        ScalingLazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .onRotaryScrollEvent { event ->
                    scope.launch { state.scrollBy(event.verticalScrollPixels) }
                    true
                }
                .focusRequester(focusRequester)
                .focusable(),
            state = state,
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            content = content
        )
    }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }
}

// ---------------------------------------------------------------- home

@Composable
private fun HomeScreen(
    status: RecordingStatus,
    selectedGesture: Gesture,
    onSelectGesture: (Gesture) -> Unit,
    permission: SensorPermission,
    onPermissionAction: () -> Unit,
    onRecord: () -> Unit,
    onClassify: () -> Unit,
    canStart: Boolean,
    calibration: Map<Gesture, Int>,
    nextToCalibrate: Gesture?,
    onCalibrate: () -> Unit,
    onResetCalibration: () -> Unit,
    onRedoGesture: (Gesture) -> Unit
) {
    val repsNeeded = BlueprintStore.REPS_NEEDED
    val calibrated = nextToCalibrate == null
    val calibrateHint = if (nextToCalibrate == null) {
        "All gestures done"
    } else {
        "${nextToCalibrate.displayName} ${(calibration[nextToCalibrate] ?: 0) + 1} of $repsNeeded"
    }

    // The line under the wordmark: one glance tells you what state the watch is in.
    val repsSaved = BlueprintStore.GESTURES.sumOf { minOf(calibration[it] ?: 0, repsNeeded) }
    val repsTotal = BlueprintStore.GESTURES.size * repsNeeded
    val systemLine = when {
        !canStart -> "Sensors off"
        calibrated -> "Sys.Ready"
        else -> "Cal $repsSaved/$repsTotal"
    }

    ScrollingScreen {
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Readout("Tactura", sizeSp = 24f)
                Label(systemLine, color = if (canStart) Ink.Muted else Ink.Accent)
            }
        }
        if (permission != SensorPermission.GRANTED) {
            item { Note("Body Sensors permission is needed to record.") }
            item {
                TacturaButton(
                    label = if (permission == SensorPermission.BLOCKED) "Open Settings" else "Grant permission",
                    onClick = onPermissionAction,
                    modifier = Modifier.fillMaxWidth(),
                    primary = true
                )
            }
        }
        if (status.message.isNotEmpty()) {
            item { Note(status.message) }
        }

        // The filled button is the next thing to do: calibrate first, then classify.
        // It also moves to the top, so it is the one sitting in the middle of the screen.
        if (!calibrated) calibrateAction(calibrateHint, canStart, onCalibrate)
        item {
            TacturaButton(
                label = "Classify",
                detail = if (calibrated) "Your blueprints" else "Old model",
                onClick = onClassify,
                modifier = Modifier.fillMaxWidth(),
                primary = calibrated,
                enabled = canStart
            )
        }
        if (calibrated) calibrateAction(calibrateHint, enabled = false, onCalibrate = onCalibrate)
        item {
            TacturaButton(
                label = "Record",
                detail = selectedGesture.displayName,
                onClick = onRecord,
                modifier = Modifier.fillMaxWidth(),
                enabled = canStart
            )
        }

        item { SectionLabel("Gesture") }
        Gesture.entries.forEach { gesture ->
            item(key = gesture.name) {
                val recorded = status.sessionTally[gesture] ?: 0
                SelectRow(
                    label = gesture.displayName,
                    selected = gesture == selectedGesture,
                    onClick = { onSelectGesture(gesture) },
                    // Calibration reps saved for this gesture. Gestures without blueprints show nothing.
                    trailing = if (gesture in BlueprintStore.GESTURES) {
                        "${minOf(calibration[gesture] ?: 0, repsNeeded)}/$repsNeeded"
                    } else {
                        null
                    },
                    detail = if (recorded > 0) "$recorded recorded" else null
                )
            }
        }

        if (calibration.values.any { it > 0 }) {
            item { SectionLabel("Calibration") }
            if ((calibration[selectedGesture] ?: 0) > 0) {
                item {
                    TacturaButton(
                        label = "Redo ${selectedGesture.displayName}",
                        detail = "Forget its reps",
                        onClick = { onRedoGesture(selectedGesture) },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
            item {
                TacturaButton(
                    label = "Reset all",
                    detail = "Forget all reps",
                    onClick = onResetCalibration,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

/** The Calibrate button. Filled while there are still reps to do, greyed out once every gesture is done. */
private fun ScalingLazyListScope.calibrateAction(hint: String, enabled: Boolean, onCalibrate: () -> Unit) {
    item {
        TacturaButton(
            label = "Calibrate",
            detail = hint,
            onClick = onCalibrate,
            modifier = Modifier.fillMaxWidth(),
            primary = true,
            enabled = enabled
        )
    }
}

// ---------------------------------------------------------------- session screens

/**
 * How to perform a gesture, shown while calibrating so every rep is done the same way.
 * Empty until the team has agreed a definition for that gesture.
 */
private fun Gesture.calibrationHint(): String = when (this) {
    Gesture.SHAKE -> "3 quick wiggles"
    else -> ""
}

private fun RecordingStatus.sessionTitle(): String = when (mode) {
    SessionMode.CLASSIFY -> "Classify"
    else -> gesture?.displayName ?: "Record"
}

@Composable
private fun CenteredScreen(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center
    ) { content() }
}

@Composable
private fun CancelButton() {
    TacturaButton(
        label = "Cancel",
        onClick = RecordingRepository::requestCancel,
        modifier = Modifier.padding(top = 8.dp),
        compact = true
    )
}

@Composable
private fun CountdownScreen(status: RecordingStatus) {
    CenteredScreen {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Label(status.sessionTitle(), color = Ink.Text, sizeSp = 12f, bold = true)
            val hint = if (status.mode == SessionMode.CALIBRATE) status.gesture?.calibrationHint().orEmpty() else ""
            Label(hint.ifEmpty { "Get ready" })
            // A dot matrix display does not slide or grow. The number just changes.
            AnimatedContent(
                targetState = status.countdownSeconds,
                transitionSpec = { fadeIn(tween(120)) togetherWith fadeOut(tween(60)) },
                label = "countdown"
            ) { seconds ->
                Readout(seconds.toString(), sizeSp = 64f)
            }
            CancelButton()
        }
    }
}

@Composable
private fun CaptureScreen(status: RecordingStatus) {
    val progress by produceState(0f, status.captureStartedAtMs) {
        if (status.captureStartedAtMs == 0L || status.captureDurationMs <= 0L) return@produceState
        while (value < 1f) {
            withFrameMillis { }
            value = ((SystemClock.elapsedRealtime() - status.captureStartedAtMs).toFloat() / status.captureDurationMs)
                .coerceIn(0f, 1f)
        }
    }
    Box(modifier = Modifier.fillMaxSize()) {
        // Red ring: the watch is listening right now.
        CircularProgressIndicator(
            progress = progress,
            modifier = Modifier.fillMaxSize().padding(2.dp),
            startAngle = 270f,
            endAngle = 270f,
            indicatorColor = Ink.Accent,
            trackColor = Ink.Line,
            strokeWidth = 3.dp
        )
        CenteredScreen {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Readout("Move", sizeSp = 48f)
                Label(status.sessionTitle(), color = Ink.Text, sizeSp = 12f, bold = true)
                Label("${status.sampleCount} samples")
                CancelButton()
            }
        }
    }
}

@Composable
private fun WorkingScreen(status: RecordingStatus) {
    CenteredScreen {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(
                modifier = Modifier.size(28.dp),
                indicatorColor = Ink.Text,
                trackColor = Ink.Line,
                strokeWidth = 2.dp
            )
            Spacer(Modifier.height(10.dp))
            Label(status.message)
        }
    }
}

// ---------------------------------------------------------------- result

@Composable
private fun ResultScreen(status: RecordingStatus, calibrationDone: Boolean, onAgain: () -> Unit, onDone: () -> Unit) {
    val classify = status.mode == SessionMode.CLASSIFY
    val calibrate = status.mode == SessionMode.CALIBRATE
    val againLabel = when {
        classify -> "Classify again"
        calibrate -> if (status.repCounted) "Next rep" else "Try again"
        else -> "Record again"
    }

    // The new result arrives in signal red, then settles to white. 1 = red, 0 = white.
    val flash = remember { Animatable(1f) }
    LaunchedEffect(Unit) { flash.animateTo(0f, tween(FLASH_MS, delayMillis = FLASH_HOLD_MS)) }

    ScrollingScreen {
        if (classify) {
            val prediction = status.prediction
            val name = prediction?.displayName ?: if (status.noGesture) "No gesture" else "No prediction"
            item {
                Label(
                    when (status.source) {
                        PredictionSource.BLUEPRINTS -> "Your blueprints"
                        PredictionSource.FOREST -> "Old model"
                        null -> "Result"
                    }
                )
            }
            item {
                Readout(
                    text = stacked(name),
                    sizeSp = readoutSize(name),
                    // A recognized gesture flashes in. "Nothing happened" stays quiet.
                    color = if (prediction != null) lerp(Ink.Text, Ink.Accent, flash.value) else Ink.Dim
                )
            }
            if (prediction != null) {
                item {
                    val word = if (status.source == PredictionSource.BLUEPRINTS) "Match" else "Confidence"
                    Label("$word ${(prediction.confidence * 100).toInt()}%", color = Ink.Text, sizeSp = 13f, bold = true)
                }
            }
        } else {
            val name = status.gesture?.displayName.orEmpty()
            item { Label(if (calibrate) "Calibration" else "Saved") }
            item { Readout(text = stacked(name), sizeSp = readoutSize(name)) }
            if (calibrate) {
                item {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        RepBlocks(
                            done = status.repNumber,
                            total = status.repsNeeded,
                            newest = if (status.repCounted) lerp(Ink.Text, Ink.Accent, flash.value) else Ink.Text
                        )
                        Spacer(Modifier.height(6.dp))
                        if (status.repCounted) {
                            Label("Rep ${status.repNumber} of ${status.repsNeeded}", color = Ink.Text, sizeSp = 12f, bold = true)
                        } else {
                            Label("Not counted", color = Ink.Accent, sizeSp = 12f, bold = true)
                        }
                    }
                }
                if (calibrationDone) {
                    item { Label("All gestures calibrated", color = Ink.Text) }
                }
            }
        }
        if (status.message.isNotEmpty() && status.message !in setOf("Saved", "Classified")) {
            item { Note(status.message) }
        }
        if (!(calibrate && calibrationDone)) {
            item {
                TacturaButton(
                    label = againLabel,
                    onClick = onAgain,
                    modifier = Modifier.fillMaxWidth(),
                    primary = true
                )
            }
        }
        item {
            TacturaButton(
                label = "Done",
                onClick = onDone,
                modifier = Modifier.fillMaxWidth(),
                // When calibration has just finished there is no "again", so Done is the main button.
                primary = calibrate && calibrationDone
            )
        }
        item { MetricsText(status.sampleCount, status.metrics) }
        status.fileName?.let { name ->
            item { Note(name, sizeSp = 9f) }
        }
    }
}

@Composable
private fun MetricsText(samples: Int, metrics: SessionMetrics) {
    val lines = buildList {
        add("$samples samples")
        add("accel %.0f Hz".format(Locale.US, metrics.accelerometerHz))
        add("gyro %.0f Hz".format(Locale.US, metrics.gyroscopeHz))
        metrics.inferenceMs?.let { add("inference %.1f ms".format(Locale.US, it)) }
        metrics.modelLoadMs?.let { add("model load $it ms") }
    }
    Note(lines.joinToString("\n").uppercase(Locale.US), sizeSp = 10f)
}

@Composable
private fun ErrorScreen(message: String, onDismiss: () -> Unit) {
    CenteredScreen {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Label("Error", color = Ink.Accent, sizeSp = 13f, bold = true)
            Spacer(Modifier.height(4.dp))
            Note(message, color = Ink.Text)
            TacturaButton(label = "OK", onClick = onDismiss, modifier = Modifier.padding(top = 8.dp), compact = true)
        }
    }
}
