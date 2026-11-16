package com.gesturedatarecorder.recording

import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import android.util.Log
import java.util.Locale

/**
 * Says a chosen word out loud, with the text-to-speech engine that is installed on the watch.
 * It follows the watch's media volume, like the ticks.
 *
 * The engine takes a moment to start. [onReady] is called once, on the main thread, with
 * whether the watch can speak English at all. Until then, and when it cannot, [speak] does
 * nothing.
 */
class WordVoice(context: Context, private val onReady: (Boolean) -> Unit) {
    private var engine: TextToSpeech? = null

    @Volatile
    private var ready = false

    init {
        engine = try {
            TextToSpeech(context.applicationContext) { status -> started(status == TextToSpeech.SUCCESS) }
        } catch (error: Exception) {
            Log.w(TAG, "No text-to-speech engine on this watch", error)
            onReady(false)
            null
        }
    }

    private fun started(success: Boolean) {
        val speech = engine
        var works = success && speech != null
        if (works && speech != null) {
            val language = speech.setLanguage(Locale.US)
            works = language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED
            if (works) {
                speech.setSpeechRate(RATE)
                speech.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
            }
        }
        if (!works) Log.w(TAG, "Text-to-speech did not start, or has no English voice")
        ready = works
        onReady(works)
    }

    /** Says [word], cutting off a word that is still being said. Returns false when the watch cannot speak. */
    fun speak(word: String): Boolean {
        val speech = engine
        if (!ready || speech == null) return false
        return speech.speak(word, TextToSpeech.QUEUE_FLUSH, null, "word") == TextToSpeech.SUCCESS
    }

    fun shutdown() {
        ready = false
        try {
            engine?.stop()
            engine?.shutdown()
        } catch (error: Exception) {
            Log.w(TAG, "Shutting down text-to-speech failed", error)
        }
        engine = null
    }

    private companion object {
        const val TAG = "WordVoice"

        /** A little slower than normal, so a single word is easy to catch. */
        const val RATE = 0.95f
    }
}
