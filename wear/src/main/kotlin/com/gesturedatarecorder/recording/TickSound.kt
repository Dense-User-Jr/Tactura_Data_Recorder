package com.gesturedatarecorder.recording

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/**
 * The ticks the simulator plays, made in code so no audio file is needed. One tick is 30 ms of
 * a tone that fades out fast. The default is the short high tick for a gesture. A lower
 * [pitchHz] with two [pulses] is the double tick for a finished word. It follows the watch's
 * media volume.
 */
class TickSound(pitchHz: Double = 1900.0, pulses: Int = 1) {
    private val track: AudioTrack? = try {
        val pulse = SAMPLE_RATE * LENGTH_MS / 1000
        val stride = SAMPLE_RATE * (LENGTH_MS + GAP_MS) / 1000
        val data = ShortArray(stride * (pulses - 1) + pulse) { i ->
            // Silence between the pulses, the fading tone inside each one.
            val inPulse = i % stride
            val t = inPulse.toDouble() / SAMPLE_RATE
            val level = if (inPulse < pulse) sin(2.0 * PI * pitchHz * t) * exp(-t * FADE) * LOUDNESS else 0.0
            (level * Short.MAX_VALUE).toInt().toShort()
        }
        AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(data.size * 2)
            .build()
            .also { it.write(data, 0, data.size) }
    } catch (error: Exception) {
        Log.w(TAG, "No tick sound on this watch", error)
        null
    }

    /** Plays the tick from its start. Does nothing when the watch could not make the sound. */
    fun play() {
        val sound = track ?: return
        try {
            sound.stop()
            sound.reloadStaticData()
            sound.play()
        } catch (error: Exception) {
            Log.w(TAG, "Tick failed", error)
        }
    }

    fun release() {
        try {
            track?.release()
        } catch (error: Exception) {
            Log.w(TAG, "Releasing the tick failed", error)
        }
    }

    private companion object {
        const val TAG = "TickSound"
        const val SAMPLE_RATE = 44_100
        const val LENGTH_MS = 30
        const val GAP_MS = 70
        const val FADE = 140.0
        const val LOUDNESS = 0.7
    }
}
