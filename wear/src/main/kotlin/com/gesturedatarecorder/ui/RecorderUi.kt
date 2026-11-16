package com.gesturedatarecorder.ui

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
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
import com.gesturedatarecorder.recording.Corrections
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

private enum class Screen { HOME, COUNTDOWN, CAPTURE, LISTEN, WORKING, RESULT, ERROR }

private fun RecordingPhase.screen(): Screen = when (this) {
    RecordingPhase.IDLE -> Screen.HOME
    RecordingPhase.COUNTDOWN -> Screen.COUNTDOWN
    RecordingPhase.CAPTURING -> Screen.CAPTURE
    RecordingPhase.LISTENING -> Screen.LISTEN
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
    // Finished sets of reps per gesture. A gesture that is being recalibrated still has its earlier ones.
    val versions by BlueprintStore.versions.collectAsState()

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
                    onListen = { RecordingService.startListening(context) },
                    canStart = canStart,
                    calibration = calibration,
                    versions = versions,
                    nextToCalibrate = nextToCalibrate,
                    onCalibrate = { RecordingService.startCalibration(context) },
                    onResetCalibration = {
                        scope.launch(Dispatchers.IO) { BlueprintStore.forget(context.applicationContext) }
                    },
                    onRecalibrate = { gesture ->
                        scope.launch(Dispatchers.IO) { BlueprintStore.startNewVersion(context.applicationContext, gesture) }
                    },
                    onForgetGesture = { gesture ->
                        scope.launch(Dispatchers.IO) { BlueprintStore.forget(context.applicationContext, gesture) }
                    }
                )
                Screen.COUNTDOWN -> CountdownScreen(shown)
                Screen.CAPTURE -> CaptureScreen(shown)
                Screen.LISTEN -> ListenScreen(shown)
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
    onListen: () -> Unit,
    canStart: Boolean,
    calibration: Map<Gesture, Int>,
    versions: Map<Gesture, Int>,
    nextToCalibrate: Gesture?,
    onCalibrate: () -> Unit,
    onResetCalibration: () -> Unit,
    onRecalibrate: (Gesture) -> Unit,
    onForgetGesture: (Gesture) -> Unit
) {
    val repsNeeded = BlueprintStore.REPS_NEEDED
    // Every gesture has at least one blueprint, so Classify uses them. Stays true while one is recalibrated.
    val calibrated = BlueprintStore.GESTURES.all { (versions[it] ?: 0) > 0 }
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
        calibrated && nextToCalibrate != null -> "Recal ${calibration[nextToCalibrate] ?: 0}/$repsNeeded"
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
                // While a gesture is being recalibrated, finishing that is the next thing to do.
                primary = calibrated && nextToCalibrate == null,
                enabled = canStart
            )
        }
        if (calibrated) {
            item {
                TacturaButton(
                    label = "Listen",
                    detail = "No button",
                    onClick = onListen,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = canStart
                )
            }
        }
        if (calibrated) calibrateAction(calibrateHint, enabled = canStart && nextToCalibrate != null, onCalibrate = onCalibrate)
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
                val known = versions[gesture] ?: 0
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
                    detail = listOfNotNull(
                        if (known > 1) "$known versions" else null,
                        if (recorded > 0) "$recorded recorded" else null
                    ).joinToString(", ").ifEmpty { null }
                )
            }
        }

        if (calibration.values.any { it > 0 } || versions.values.any { it > 0 }) {
            item { SectionLabel("Calibration") }
            val selectedVersions = versions[selectedGesture] ?: 0
            if ((calibration[selectedGesture] ?: 0) > 0 || selectedVersions > 0) {
                item {
                    TacturaButton(
                        label = "Recalibrate ${selectedGesture.displayName}",
                        // The blueprints it already has are kept, and Classify goes on using them.
                        detail = if (selectedVersions > 0) "Adds a version" else "Start its reps over",
                        onClick = { onRecalibrate(selectedGesture) },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                item {
                    TacturaButton(
                        label = "Forget ${selectedGesture.displayName}",
                        detail = if (selectedVersions > 1) "All $selectedVersions versions" else "Its reps",
                        onClick = { onForgetGesture(selectedGesture) },
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

/** The Calibrate button. Filled while there are still reps to do, greyed out when no gesture needs any. */
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

/**
 * Listen mode: the watch names gestures as they happen and spells words with them.
 *
 * Around the edge is the map of which gesture gives which phonemes, laid out the way the team
 * pictures it: Twist Left at the top, Twist Right at the bottom, the two flicks on the right
 * with an arrow each, Shake on the left. The one just made lights up red. The middle shows the
 * gestures made so far and the words they could be. Tapping a word chooses it and starts the next.
 */
@Composable
private fun ListenScreen(status: RecordingStatus) {
    val latest = Gesture.fromLabel(status.heard.lastOrNull())

    // Every new gesture and every finished word arrives in signal red, then settles to white. 1 = red, 0 = white.
    val flash = remember { Animatable(0f) }
    LaunchedEffect(status.heardCount, status.wordCount) {
        if (status.heardCount + status.wordCount > 0) {
            flash.snapTo(1f)
            flash.animateTo(0f, tween(FLASH_MS, delayMillis = FLASH_HOLD_MS))
        }
    }
    val hot = lerp(Ink.Text, Ink.Accent, flash.value)

    Box(modifier = Modifier.fillMaxSize()) {
        BinMark(Gesture.TWIST_LEFT, "Twist L", latest, hot, Modifier.align(Alignment.TopCenter).padding(top = 10.dp))
        BinMark(Gesture.TWIST_RIGHT, "Twist R", latest, hot, Modifier.align(Alignment.BottomCenter).padding(bottom = 10.dp))
        BinMark(Gesture.SHAKE, "Shake", latest, hot, Modifier.align(Alignment.CenterStart).padding(start = 10.dp))
        Column(
            modifier = Modifier.align(Alignment.CenterEnd).padding(end = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            BinMark(Gesture.FLICK_UP, "Flick", latest, hot, arrowUp = true)
            BinMark(Gesture.FLICK_DOWN, "Flick", latest, hot, arrowUp = false)
        }

        Column(
            modifier = Modifier.align(Alignment.Center).width(LISTEN_CENTER_DP.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            val word = status.word
            when {
                // Spelling: the first phoneme of each bin so far, then the words to tap.
                latest != null -> {
                    Label(
                        status.heard.takeLast(6).mapNotNull { Gesture.fromLabel(it)?.phonemes?.substringBefore('/') }.joinToString(" "),
                        color = hot,
                        sizeSp = 11f,
                        bold = true
                    )
                    // Words these gestures spell come first. Words they only start follow, dimmer.
                    val offered = (status.words.map { it to true } + status.wordHints.map { it to false }).take(LISTEN_WORDS)
                    if (offered.isEmpty()) Label("No word", color = Ink.Accent, sizeSp = 12f, bold = true)
                    offered.forEach { (candidate, whole) ->
                        WordChoice(candidate, whole) { RecordingRepository.chooseWord(candidate) }
                    }
                }
                // The word that was just chosen, until the next gesture.
                word != null -> Readout(word, sizeSp = readoutSize(word, maxSp = 30f, widthDp = LISTEN_CENTER_DP), color = hot)
                else -> Label("Make a gesture")
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (status.heard.isNotEmpty()) TapLabel("Undo", RecordingRepository::undoGesture)
                TapLabel("Stop", RecordingRepository::requestCancel)
            }
        }
    }
}

/** How many words the Listen screen offers at once. */
private const val LISTEN_WORDS = 3

/**
 * One word the user can tap in Listen mode. [whole] words are spelled exactly by the gestures
 * made so far. The others only start with them, and are drawn dimmer.
 */
@Composable
private fun WordChoice(word: String, whole: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(ChamferSmall)
            .border(1.dp, if (whole) Ink.Text else Ink.LineStrong, ChamferSmall)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = 5.dp),
        contentAlignment = Alignment.Center
    ) {
        Label(word, color = if (whole) Ink.Text else Ink.Muted, sizeSp = 13f, bold = whole)
    }
}

/** A small word to tap, for the things the Listen screen needs less often. */
@Composable
private fun TapLabel(text: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier.clickable(role = Role.Button, onClick = onClick).padding(horizontal = 9.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center
    ) {
        Label(text, color = Ink.Muted, sizeSp = 10f, bold = true)
    }
}

/** Width of the middle of the Listen screen, between Shake on the left and the flicks on the right. */
private const val LISTEN_CENTER_DP = 104f

/**
 * One entry of the Listen screen's map: a gesture's phonemes with its name underneath.
 * It is drawn in [hot] when it is the gesture that was just made ([latest]). [arrowUp] puts a
 * small arrow above it, pointing up or down, to tell the two flicks apart.
 */
@Composable
private fun BinMark(
    gesture: Gesture,
    name: String,
    latest: Gesture?,
    hot: Color,
    modifier: Modifier = Modifier,
    arrowUp: Boolean? = null
) {
    val lit = gesture == latest
    val ink = if (lit) hot else Ink.Muted
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        if (arrowUp != null) {
            Canvas(Modifier.size(9.dp)) {
                val arrow = Path().apply {
                    if (arrowUp) {
                        moveTo(size.width / 2f, 0f)
                        lineTo(size.width, size.height)
                        lineTo(0f, size.height)
                    } else {
                        moveTo(0f, 0f)
                        lineTo(size.width, 0f)
                        lineTo(size.width / 2f, size.height)
                    }
                    close()
                }
                drawPath(arrow, ink)
            }
            Spacer(Modifier.height(2.dp))
        }
        Label(gesture.phonemes, color = ink, sizeSp = 11f, bold = true)
        Label(name, color = if (lit) hot else Ink.Dim, sizeSp = 8f)
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

    // Wrong?: the user tells the watch what the movement really was. Only for the user's own blueprints.
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var correcting by remember { mutableStateOf(false) }
    var corrected by remember { mutableStateOf(false) }
    val canCorrect = classify && status.source == PredictionSource.BLUEPRINTS && !corrected
    if (correcting) {
        CorrectionPicker(
            said = Gesture.fromLabel(status.prediction?.label),
            onPick = { truth ->
                correcting = false
                corrected = true
                scope.launch(Dispatchers.IO) {
                    val message = Corrections.apply(context.applicationContext, truth)
                    RecordingRepository.update { it.copy(message = message) }
                }
            },
            onCancel = { correcting = false }
        )
        return
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
        if (canCorrect) {
            item {
                TacturaButton(
                    label = "Wrong?",
                    detail = "Say what it was",
                    onClick = { correcting = true },
                    modifier = Modifier.fillMaxWidth()
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

/**
 * The list behind Wrong?: what the movement really was. [said] is the gesture the watch named,
 * or null when it said "No gesture". "Nothing" is only offered when the watch named a gesture.
 */
@Composable
private fun CorrectionPicker(said: Gesture?, onPick: (Gesture?) -> Unit, onCancel: () -> Unit) {
    ScrollingScreen {
        item { Label("What was it?", color = Ink.Text, sizeSp = 12f, bold = true) }
        BlueprintStore.GESTURES.filter { it != said }.forEach { gesture ->
            item(key = gesture.name) {
                TacturaButton(
                    label = gesture.displayName,
                    onClick = { onPick(gesture) },
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
        if (said != null) {
            item {
                TacturaButton(
                    label = "Nothing",
                    detail = "I did no gesture",
                    onClick = { onPick(null) },
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
        item { TacturaButton(label = "Cancel", onClick = onCancel, modifier = Modifier.fillMaxWidth()) }
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
