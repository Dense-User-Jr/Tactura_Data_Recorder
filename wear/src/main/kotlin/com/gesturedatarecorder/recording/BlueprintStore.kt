package com.gesturedatarecorder.recording

import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The user's calibration reps, kept in a small JSON file in app-private storage, and the
 * blueprints built from them.
 *
 * This is the only place that reads or writes that file. The reps themselves (the clips) are
 * stored, not just the averages, so a blueprint can always be rebuilt and a half-finished
 * calibration survives closing the app.
 *
 * Every function that touches the file takes a [Context] and must be called off the main thread.
 */
object BlueprintStore {
    private const val TAG = "BlueprintStore"
    private const val FILE_NAME = "blueprints.json"
    private const val VERSION = 1

    /** Reps of each gesture that calibration asks for. */
    const val REPS_NEEDED = 5

    /**
     * Gestures that calibration covers, in the order it asks for them. Double Tap is left out
     * until it has a definition the gyroscope can see.
     */
    val GESTURES: List<Gesture> = listOf(
        Gesture.FLICK_UP,
        Gesture.FLICK_DOWN,
        Gesture.TWIST_RIGHT,
        Gesture.TWIST_LEFT,
        Gesture.SHAKE
    )

    private val clips = LinkedHashMap<Gesture, MutableList<Array<DoubleArray>>>()
    private var loaded = false
    private var built: Map<String, GestureBlueprints.Blueprint>? = null

    private val _progress = MutableStateFlow<Map<Gesture, Int>>(emptyMap())

    /** Reps saved per gesture. The UI watches this to show what calibration still needs. */
    val progress: StateFlow<Map<Gesture, Int>> = _progress.asStateFlow()

    /** Reads the saved reps once per process. Safe to call again. */
    @Synchronized
    fun load(context: Context) {
        if (loaded) return
        loaded = true
        val file = File(context.filesDir, FILE_NAME)
        if (file.isFile) {
            try {
                val saved = JSONObject(file.readText()).getJSONObject("gestures")
                for (gesture in GESTURES) {
                    val reps = saved.optJSONArray(gesture.name) ?: continue
                    val list = ArrayList<Array<DoubleArray>>()
                    for (r in 0 until reps.length()) {
                        fromJson(reps.getJSONArray(r))?.let { list.add(it) }
                    }
                    if (list.isNotEmpty()) clips[gesture] = list
                }
            } catch (error: Exception) {
                Log.e(TAG, "Could not read $FILE_NAME; starting with no calibration", error)
                clips.clear()
            }
        }
        publish()
    }

    @Synchronized
    fun reps(gesture: Gesture): Int = clips[gesture]?.size ?: 0

    /** The first gesture that still needs reps, or null when calibration is finished. */
    @Synchronized
    fun nextToCalibrate(): Gesture? = GESTURES.firstOrNull { reps(it) < REPS_NEEDED }

    /** True once every gesture has [REPS_NEEDED] reps, which is when Classify starts using blueprints. */
    @Synchronized
    fun isComplete(): Boolean = GESTURES.all { reps(it) >= REPS_NEEDED }

    /** Saves one more rep of [gesture] and returns how many it now has. */
    @Synchronized
    fun addRep(context: Context, gesture: Gesture, clip: Array<DoubleArray>): Int {
        load(context)
        val list = clips.getOrPut(gesture) { ArrayList() }
        list.add(clip)
        built = null
        save(context)
        publish()
        return list.size
    }

    /** One blueprint per fully calibrated gesture, keyed by the gesture's label. */
    @Synchronized
    fun blueprints(): Map<String, GestureBlueprints.Blueprint> {
        built?.let { return it }
        val result = LinkedHashMap<String, GestureBlueprints.Blueprint>()
        for (gesture in GESTURES) {
            val list = clips[gesture] ?: continue
            if (list.size >= REPS_NEEDED) result[gesture.name] = GestureBlueprints.build(list)
        }
        built = result
        return result
    }

    /** Forgets every rep, so calibration starts over. */
    @Synchronized
    fun clear(context: Context) {
        loaded = true
        clips.clear()
        built = null
        save(context)
        publish()
    }

    private fun publish() {
        _progress.value = GESTURES.associateWith { reps(it) }
    }

    private fun save(context: Context) {
        try {
            val gestures = JSONObject()
            for ((gesture, list) in clips) {
                val reps = JSONArray()
                for (clip in list) reps.put(toJson(clip))
                gestures.put(gesture.name, reps)
            }
            val root = JSONObject().put("version", VERSION).put("gestures", gestures)
            // Write to a temporary file first, so a crash mid-write cannot leave a broken file.
            val target = File(context.filesDir, FILE_NAME)
            val temporary = File(context.filesDir, "$FILE_NAME.tmp")
            temporary.writeText(root.toString())
            if (!temporary.renameTo(target)) {
                target.writeText(root.toString())
                temporary.delete()
            }
        } catch (error: Exception) {
            Log.e(TAG, "Could not save $FILE_NAME", error)
        }
    }

    /** A clip as one flat list: all of axis 0, then axis 1, then axis 2. */
    private fun toJson(clip: Array<DoubleArray>): JSONArray {
        val flat = JSONArray()
        for (axis in clip.indices) {
            for (value in clip[axis]) flat.put(value)
        }
        return flat
    }

    private fun fromJson(flat: JSONArray): Array<DoubleArray>? {
        if (flat.length() != 3 * MotionClip.CLIP_LEN) return null
        return Array(3) { axis ->
            DoubleArray(MotionClip.CLIP_LEN) { i -> flat.getDouble(axis * MotionClip.CLIP_LEN + i) }
        }
    }
}
