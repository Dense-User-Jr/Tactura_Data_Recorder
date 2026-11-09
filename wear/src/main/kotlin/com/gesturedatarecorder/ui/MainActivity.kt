package com.gesturedatarecorder.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.gesturedatarecorder.recording.RecordingRepository

/** State of the Body Sensors permission, which the `health` foreground service type requires. */
enum class SensorPermission {
    GRANTED,

    /** Never requested yet. */
    NOT_REQUESTED,

    /** Denied, but the system dialog can still be shown. */
    DENIED,

    /** Denied in a way the dialog won't reappear; the user must use app Settings. */
    BLOCKED
}

class MainActivity : ComponentActivity() {
    private var permission by mutableStateOf(SensorPermission.NOT_REQUESTED)
    private val prefs by lazy { getSharedPreferences("ui", MODE_PRIVATE) }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { refreshPermission() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        refreshPermission()
        if (permission == SensorPermission.NOT_REQUESTED) requestPermissions()
        setContent { RecorderApp(permission = permission, onPermissionAction = ::onPermissionAction) }
    }

    override fun onResume() {
        super.onResume()
        // The user may have changed the permission in Settings.
        refreshPermission()
    }

    override fun onDestroy() {
        // Leaving the app ends a session in progress (not on configuration changes).
        if (isFinishing) RecordingRepository.requestCancel()
        super.onDestroy()
    }

    private fun refreshPermission() {
        permission = when {
            ContextCompat.checkSelfPermission(this, Manifest.permission.BODY_SENSORS) ==
                PackageManager.PERMISSION_GRANTED -> SensorPermission.GRANTED
            !prefs.getBoolean(KEY_ASKED, false) -> SensorPermission.NOT_REQUESTED
            shouldShowRequestPermissionRationale(Manifest.permission.BODY_SENSORS) -> SensorPermission.DENIED
            else -> SensorPermission.BLOCKED
        }
    }

    private fun onPermissionAction() {
        if (permission != SensorPermission.BLOCKED) {
            requestPermissions()
            return
        }
        try {
            startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))
            )
        } catch (_: ActivityNotFoundException) {
            requestPermissions()
        }
    }

    private fun requestPermissions() {
        prefs.edit().putBoolean(KEY_ASKED, true).apply()
        val permissions = buildList {
            add(Manifest.permission.BODY_SENSORS)
            // Optional: lets the session notification show. Sessions work without it.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        permissionLauncher.launch(permissions.toTypedArray())
    }

    private companion object {
        const val KEY_ASKED = "body_sensors_asked"
    }
}
