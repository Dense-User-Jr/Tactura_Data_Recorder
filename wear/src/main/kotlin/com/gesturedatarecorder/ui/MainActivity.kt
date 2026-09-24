package com.gesturedatarecorder.ui

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import com.gesturedatarecorder.recording.Gesture
import com.gesturedatarecorder.recording.RecordingPhase
import com.gesturedatarecorder.recording.RecordingService
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    private var bodySensorsGranted by mutableStateOf(false)

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        bodySensorsGranted = granted
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        bodySensorsGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.BODY_SENSORS) == PackageManager.PERMISSION_GRANTED
        if (!bodySensorsGranted) {
            permissionLauncher.launch(Manifest.permission.BODY_SENSORS)
        }
        setContent { RecorderTheme { RecorderScreen(bodySensorsGranted) } }
    }

    override fun onDestroy() {
        RecordingService.cancel(this)
        super.onDestroy()
    }
}

@Composable
private fun RecorderTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = androidx.wear.compose.material.Colors(
            primary = Color(0xFFFFB74D),
            primaryVariant = Color(0xFFF57C00),
            secondary = Color(0xFF80CBC4),
            secondaryVariant = Color(0xFF00897B),
            background = Color(0xFF101418),
            surface = Color(0xFF1C2429),
            error = Color(0xFFEF9A9A),
            onPrimary = Color.Black,
            onSecondary = Color.Black,
            onBackground = Color.White,
            onSurface = Color.White,
            onError = Color.Black
        ),
        content = content
    )
}

@Composable
private fun RecorderScreen(bodySensorsGranted: Boolean) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var selectedGesture by remember { mutableStateOf(Gesture.FLICK_UP) }
    var status by remember { mutableStateOf(RecordingUiState()) }

    DisposableEffect(Unit) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                status = RecordingUiState(
                    phase = runCatching { RecordingPhase.valueOf(intent.getStringExtra(RecordingService.EXTRA_PHASE).orEmpty()) }
                        .getOrDefault(RecordingPhase.IDLE),
                    countdown = intent.getIntExtra(RecordingService.EXTRA_COUNTDOWN, 0),
                    samples = intent.getIntExtra(RecordingService.EXTRA_SAMPLES, 0),
                    message = intent.getStringExtra(RecordingService.EXTRA_MESSAGE).orEmpty(),
                    fileName = intent.getStringExtra(RecordingService.EXTRA_FILE)
                )
            }
        }
        context.registerReceiver(receiver, IntentFilter(RecordingService.ACTION_STATUS), Context.RECEIVER_NOT_EXPORTED)
        onDispose { context.unregisterReceiver(receiver) }
    }

    LaunchedEffect(status.phase) {
        if (status.phase == RecordingPhase.COMPLETE || status.phase == RecordingPhase.ERROR) {
            delay(5_000)
            status = RecordingUiState()
        }
    }

    val busy = status.phase == RecordingPhase.COUNTDOWN || status.phase == RecordingPhase.RECORDING || status.phase == RecordingPhase.SAVING
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize().background(Color(0xFF101418)),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 8.dp)
    ) {
        item {
            Text("Gesture Data", color = Color(0xFFFFB74D), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Text("Recorder", color = Color(0xFFFFB74D), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
        item {
            Text(
                text = if (bodySensorsGranted) status.message else "Allow Body Sensors to record",
                color = Color(0xFFB0BEC5),
                fontSize = 10.sp,
                textAlign = TextAlign.Center
            )
        }
        if (status.phase == RecordingPhase.COUNTDOWN) {
            item { Text(status.countdown.toString(), color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold) }
        }
        if (status.phase == RecordingPhase.RECORDING) {
            item { Text("Samples: ${status.samples}", color = Color(0xFF80CBC4), fontSize = 10.sp) }
        }
        status.fileName?.let { fileName ->
            item { Text(fileName, color = Color(0xFF80CBC4), fontSize = 8.sp, textAlign = TextAlign.Center) }
        }
        item { Text("Label", color = Color(0xFF90A4AE), fontSize = 9.sp) }
        Gesture.values().toList().chunked(2).forEach { row ->
            item {
                Row(horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    row.forEach { gesture ->
                        GestureButton(gesture, selectedGesture, busy) { selectedGesture = it }
                    }
                }
            }
        }
        item {
            if (busy) {
                Button(onClick = { RecordingService.cancel(context) }) { Text("Cancel", fontSize = 11.sp) }
            } else {
                Button(
                    onClick = { RecordingService.start(context, selectedGesture) },
                    enabled = bodySensorsGranted
                ) { Text("Record", fontSize = 11.sp) }
            }
        }
    }
}

@Composable
private fun GestureButton(gesture: Gesture, selected: Gesture, disabled: Boolean, onSelected: (Gesture) -> Unit) {
    Chip(
        modifier = Modifier.width(82.dp).padding(2.dp),
        label = { Text(gesture.displayName, fontSize = 8.sp) },
        onClick = { onSelected(gesture) },
        enabled = !disabled,
        colors = androidx.wear.compose.material.ChipDefaults.primaryChipColors(
            backgroundColor = if (gesture == selected) Color(0xFFF57C00) else Color(0xFF263238),
            contentColor = Color.White
        )
    )
}

private data class RecordingUiState(
    val phase: RecordingPhase = RecordingPhase.IDLE,
    val countdown: Int = 0,
    val samples: Int = 0,
    val message: String = "Select a gesture",
    val fileName: String? = null
)
