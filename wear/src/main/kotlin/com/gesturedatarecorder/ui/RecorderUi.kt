package com.gesturedatarecorder.ui

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
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
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.ToggleChip
import androidx.wear.compose.material.ToggleChipDefaults
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import com.gesturedatarecorder.recording.Gesture
import com.gesturedatarecorder.recording.RecordingPhase
import com.gesturedatarecorder.recording.RecordingRepository
import com.gesturedatarecorder.recording.RecordingService
import com.gesturedatarecorder.recording.RecordingStatus
import com.gesturedatarecorder.recording.SessionMetrics
import com.gesturedatarecorder.recording.SessionMode
import kotlinx.coroutines.launch
import java.util.Locale

private val Amber = Color(0xFFFFB74D)
private val Teal = Color(0xFF80CBC4)
private val Muted = Color(0xFFB0BEC5)

private val RecorderColors = Colors(
    primary = Amber,
    primaryVariant = Color(0xFFF57C00),
    secondary = Teal,
    secondaryVariant = Color(0xFF00897B),
    background = Color(0xFF101418),
    surface = Color(0xFF1C2429),
    error = Color(0xFFEF9A9A),
    onPrimary = Color.Black,
    onSecondary = Color.Black,
    onBackground = Color.White,
    onSurface = Color.White,
    onSurfaceVariant = Muted,
    onError = Color.Black
)

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

    // Back cancels a running session or dismisses a result instead of leaving the app.
    BackHandler(enabled = status.phase.isBusy) { RecordingRepository.requestCancel() }
    BackHandler(enabled = status.phase == RecordingPhase.COMPLETE || status.phase == RecordingPhase.ERROR) {
        RecordingRepository.dismissResult()
    }

    MaterialTheme(colors = RecorderColors) {
        AnimatedContent(
            targetState = status,
            contentKey = { it.phase.screen() },
            transitionSpec = {
                (fadeIn(tween(220)) + scaleIn(tween(220), initialScale = 0.96f)) togetherWith fadeOut(tween(120))
            },
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
                    canStart = canStart
                )
                Screen.COUNTDOWN -> CountdownScreen(shown)
                Screen.CAPTURE -> CaptureScreen(shown)
                Screen.WORKING -> WorkingScreen(shown)
                Screen.RESULT -> ResultScreen(
                    status = shown,
                    onAgain = {
                        when (shown.mode) {
                            SessionMode.CLASSIFY -> RecordingService.startClassification(context)
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

@Composable
private fun HomeScreen(
    status: RecordingStatus,
    selectedGesture: Gesture,
    onSelectGesture: (Gesture) -> Unit,
    permission: SensorPermission,
    onPermissionAction: () -> Unit,
    onRecord: () -> Unit,
    onClassify: () -> Unit,
    canStart: Boolean
) {
    ScrollingScreen {
        item { ListHeader { Text("Gesture Recorder", color = Amber, fontWeight = FontWeight.SemiBold) } }
        if (permission != SensorPermission.GRANTED) {
            item {
                Text(
                    "Body Sensors permission is needed to record.",
                    color = Muted,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center
                )
            }
            item {
                Chip(
                    modifier = Modifier.fillMaxWidth(),
                    onClick = onPermissionAction,
                    label = { Text(if (permission == SensorPermission.BLOCKED) "Open Settings" else "Grant permission") },
                    colors = ChipDefaults.primaryChipColors()
                )
            }
        }
        if (status.message.isNotEmpty()) {
            item { Text(status.message, color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center) }
        }
        item {
            Chip(
                modifier = Modifier.fillMaxWidth(),
                onClick = onRecord,
                enabled = canStart,
                label = { Text("Record") },
                secondaryLabel = { Text(selectedGesture.displayName) },
                colors = ChipDefaults.primaryChipColors()
            )
        }
        item {
            Chip(
                modifier = Modifier.fillMaxWidth(),
                onClick = onClassify,
                enabled = canStart,
                label = { Text("Classify") },
                secondaryLabel = { Text("On-watch model") },
                colors = ChipDefaults.secondaryChipColors()
            )
        }
        item { ListHeader { Text("Gesture to record", color = Muted) } }
        Gesture.entries.forEach { gesture ->
            item(key = gesture.name) {
                val count = status.sessionTally[gesture] ?: 0
                ToggleChip(
                    modifier = Modifier.fillMaxWidth(),
                    checked = gesture == selectedGesture,
                    onCheckedChange = { onSelectGesture(gesture) },
                    label = { Text(gesture.displayName) },
                    secondaryLabel = if (count > 0) ({ Text("$count recorded") }) else null,
                    toggleControl = {
                        Icon(
                            imageVector = ToggleChipDefaults.radioIcon(gesture == selectedGesture),
                            contentDescription = if (gesture == selectedGesture) "Selected" else null
                        )
                    }
                )
            }
        }
    }
}

// ---------------------------------------------------------------- session screens

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
    Button(
        onClick = RecordingRepository::requestCancel,
        colors = ButtonDefaults.secondaryButtonColors(),
        modifier = Modifier.padding(top = 8.dp)
    ) { Text("Cancel", fontSize = 12.sp) }
}

@Composable
private fun CountdownScreen(status: RecordingStatus) {
    CenteredScreen {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(status.sessionTitle(), color = Amber, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Text("Get ready", color = Muted, fontSize = 13.sp)
            AnimatedContent(
                targetState = status.countdownSeconds,
                transitionSpec = { (fadeIn(tween(150)) + scaleIn(tween(250), initialScale = 1.4f)) togetherWith fadeOut(tween(100)) },
                label = "countdown"
            ) { seconds ->
                Text(seconds.toString(), color = Color.White, fontSize = 56.sp, fontWeight = FontWeight.Bold)
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
        CircularProgressIndicator(
            progress = progress,
            modifier = Modifier.fillMaxSize().padding(2.dp),
            startAngle = 270f,
            endAngle = 270f,
            indicatorColor = Teal,
            strokeWidth = 6.dp
        )
        CenteredScreen {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("MOVE NOW", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text(status.sessionTitle(), color = Amber, fontSize = 15.sp)
                Text("${status.sampleCount} samples", color = Muted, fontSize = 12.sp)
                CancelButton()
            }
        }
    }
}

@Composable
private fun WorkingScreen(status: RecordingStatus) {
    CenteredScreen {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(indicatorColor = Amber)
            Spacer(Modifier.height(8.dp))
            Text(status.message, color = Muted, fontSize = 13.sp, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun ResultScreen(status: RecordingStatus, onAgain: () -> Unit, onDone: () -> Unit) {
    val classify = status.mode == SessionMode.CLASSIFY
    ScrollingScreen {
        item { ListHeader { Text(if (classify) "Prediction" else "Saved", color = Muted) } }
        if (classify) {
            val prediction = status.prediction
            item {
                Text(
                    prediction?.displayName ?: "No prediction",
                    color = Color.White,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )
            }
            if (prediction != null) {
                item {
                    Text(
                        "${(prediction.confidence * 100).toInt()}% confidence",
                        color = confidenceColor(prediction.confidence),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        } else {
            item {
                Text(
                    status.gesture?.displayName.orEmpty(),
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }
        item { MetricsText(status.sampleCount, status.metrics) }
        status.fileName?.let { name ->
            item { Text(name, color = Teal, fontSize = 11.sp, textAlign = TextAlign.Center) }
        }
        if (status.message.isNotEmpty() && status.message !in setOf("Saved", "Classified")) {
            item { Text(status.message, color = MaterialTheme.colors.error, fontSize = 12.sp, textAlign = TextAlign.Center) }
        }
        item {
            Chip(
                modifier = Modifier.fillMaxWidth(),
                onClick = onAgain,
                label = { Text(if (classify) "Classify again" else "Record again") },
                colors = ChipDefaults.primaryChipColors()
            )
        }
        item {
            Chip(
                modifier = Modifier.fillMaxWidth(),
                onClick = onDone,
                label = { Text("Done") },
                colors = ChipDefaults.secondaryChipColors()
            )
        }
    }
}

@Composable
private fun MetricsText(samples: Int, metrics: SessionMetrics) {
    val lines = buildList {
        add("$samples samples")
        add("accel %.0f Hz · gyro %.0f Hz".format(Locale.US, metrics.accelerometerHz, metrics.gyroscopeHz))
        metrics.inferenceMs?.let { add("inference %.1f ms".format(Locale.US, it)) }
        metrics.modelLoadMs?.let { add("model load $it ms") }
    }
    Text(lines.joinToString("\n"), color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center)
}

private fun confidenceColor(confidence: Float): Color = when {
    confidence >= 0.7f -> Teal
    confidence >= 0.4f -> Amber
    else -> Color(0xFFEF9A9A)
}

@Composable
private fun ErrorScreen(message: String, onDismiss: () -> Unit) {
    CenteredScreen {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Error", color = MaterialTheme.colors.error, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Text(message, color = Color.White, fontSize = 13.sp, textAlign = TextAlign.Center)
            Button(onClick = onDismiss, modifier = Modifier.padding(top = 8.dp)) { Text("OK", fontSize = 12.sp) }
        }
    }
}
