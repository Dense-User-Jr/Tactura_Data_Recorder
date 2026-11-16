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
 * A gesture can have several sets of reps, one for each time it was calibrated. Recalibrating
 * adds a set instead of replacing the old one, because people do not do a small gesture the same
 * way from one sitting to the next. Every finished set becomes its own blueprint, and Classify
 * compares a movement with all of them.
 *
 * Two more things are kept per gesture, both fed by the **Wrong?** button. Corrections are
 * movements the user said were that gesture when the watch said something else: once there are
 * [REPS_NEEDED] of them they become one more set. Notes are movements the watch took for that
 * gesture and the user said were nothing: Classify refuses movements that look like them
 * ([GestureBlueprints.refusedByNotes]).
 *
 * Every function that touches the file takes a [Context] and must be called off the main thread.
 */
object BlueprintStore {
    private const val TAG = "BlueprintStore"
    private const val FILE_NAME = "blueprints.json"

    /**
     * File layout. 1 kept one list of reps per gesture; 2 keeps a list of sets per gesture, and
     * since the Wrong? button also its corrections and notes.
     */
    private const val VERSION = 2

    /** Reps of each gesture that calibration asks for. */
    const val REPS_NEEDED = 5

    /**
     * How many times calibration will drop a rep that does not match the others and ask for one
     * more, per set. After that it keeps what it has, so an inconsistent gesture cannot trap the
     * user in an endless loop.
     */
    const val MAX_DROPS = 3

    /** Finished sets remembered per gesture. When one more is finished, the oldest is forgotten. */
    const val MAX_VERSIONS = 10

    /** Notes remembered per gesture. When one more is added, the oldest is forgotten. */
    const val MAX_NOTES = 30

    /**
     * What happened when a correction was added: how many corrections of the gesture are now
     * waiting, whether they just became a new set, and how many finished sets the gesture has.
     */
    class CorrectionResult(val waiting: Int, val becameVersion: Boolean, val versions: Int)

    /** What happened when a note was added: whether the watch now ignores movements like it. */
    class NoteResult(val count: Int, val active: Boolean)

    /**
     * What happened when a rep was added: how many reps the set being calibrated has now, whether
     * the least typical rep was dropped to make room for a better one, and whether the reps still
     * do not match each other after [MAX_DROPS] drops.
     */
    class AddResult(val count: Int, val dropped: Boolean, val inconsistent: Boolean)

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

    /**
     * Every set of reps of each gesture, oldest first. Only the last set of a gesture may still
     * be short of [REPS_NEEDED]: it is the one being calibrated.
     */
    private val sets = LinkedHashMap<Gesture, MutableList<MutableList<Array<DoubleArray>>>>()
    private val drops = HashMap<Gesture, Int>()

    /** Corrections of each gesture that are waiting to become a set. */
    private val corrections = HashMap<Gesture, MutableList<Array<DoubleArray>>>()
    private val correctionDrops = HashMap<Gesture, Int>()

    /** Movements the user said were nothing, kept on the gesture the watch took them for. */
    private val notes = HashMap<Gesture, MutableList<Array<DoubleArray>>>()
    private var loaded = false
    private var built: Map<String, List<GestureBlueprints.Blueprint>>? = null

    private val _progress = MutableStateFlow<Map<Gesture, Int>>(emptyMap())

    /** Reps in the set being calibrated, per gesture. The UI watches this to show what calibration still needs. */
    val progress: StateFlow<Map<Gesture, Int>> = _progress.asStateFlow()

    private val _versions = MutableStateFlow<Map<Gesture, Int>>(emptyMap())

    /** Finished sets per gesture, which is the number of blueprints Classify can use for it. */
    val versions: StateFlow<Map<Gesture, Int>> = _versions.asStateFlow()

    /** Reads the saved reps once per process. Safe to call again. */
    @Synchronized
    fun load(context: Context) {
        if (loaded) return
        loaded = true
        val file = File(context.filesDir, FILE_NAME)
        if (file.isFile) {
            try {
                val root = JSONObject(file.readText())
                val layout = root.optInt("version", 1)
                val saved = root.getJSONObject("gestures")
                for (gesture in GESTURES) {
                    val all = ArrayList<MutableList<Array<DoubleArray>>>()
                    if (layout >= 2) {
                        val entry = saved.optJSONObject(gesture.name) ?: continue
                        entry.optJSONArray("corrections")?.let { stored ->
                            clipsFromJson(stored).takeIf { it.isNotEmpty() }?.let { corrections[gesture] = it }
                        }
                        entry.optJSONArray("notes")?.let { stored ->
                            clipsFromJson(stored).takeIf { it.isNotEmpty() }?.let { notes[gesture] = it }
                        }
                        val stored = entry.optJSONArray("sets") ?: continue
                        for (s in 0 until stored.length()) all.add(clipsFromJson(stored.getJSONArray(s)))
                    } else {
                        // The old layout had one list of reps per gesture: that list is the first set.
                        val reps = saved.optJSONArray(gesture.name) ?: continue
                        all.add(clipsFromJson(reps))
                    }
                    // An empty set is only meaningful at the end, where it means "calibrate this again".
                    while (all.size > 1 && all[0].isEmpty()) all.removeAt(0)
                    if (all.isNotEmpty()) sets[gesture] = all
                }
            } catch (error: Exception) {
                Log.e(TAG, "Could not read $FILE_NAME; starting with no calibration", error)
                sets.clear()
                corrections.clear()
                notes.clear()
            }
        }
        publish()
    }

    /** Reps in the set of [gesture] that is being calibrated. */
    @Synchronized
    fun reps(gesture: Gesture): Int = sets[gesture]?.lastOrNull()?.size ?: 0

    /** Finished sets of [gesture]. */
    @Synchronized
    fun versionCount(gesture: Gesture): Int = sets[gesture]?.count { it.size >= REPS_NEEDED } ?: 0

    /** The first gesture whose current set still needs reps, or null when calibration is finished. */
    @Synchronized
    fun nextToCalibrate(): Gesture? = GESTURES.firstOrNull { reps(it) < REPS_NEEDED }

    /** True once every gesture has at least one finished set, which is when Classify uses blueprints. */
    @Synchronized
    fun isComplete(): Boolean = GESTURES.all { versionCount(it) > 0 }

    /**
     * Saves one more rep of [gesture] in the set being calibrated.
     *
     * [candidates] holds one clip per strong stroke in the window, loudest first
     * ([MotionClip.Extraction.clips]), and must not be empty. The clip that best fits the reps
     * already in the set is the one kept, so a gesture with two equally strong strokes is always
     * centred on the same stroke.
     *
     * Once the set has [REPS_NEEDED] reps, each rep is checked against the others. If the least
     * typical one would not be recognised from the rest, it is dropped so the user can replace
     * it, up to [MAX_DROPS] times per set.
     */
    @Synchronized
    fun addRep(context: Context, gesture: Gesture, candidates: List<Array<DoubleArray>>): AddResult {
        load(context)
        val all = sets.getOrPut(gesture) { ArrayList() }
        if (all.isEmpty()) all.add(ArrayList())
        val list = all[all.size - 1]
        list.add(candidates[GestureBlueprints.chooseClip(candidates, list)])
        var dropped = false
        var inconsistent = false
        if (list.size >= REPS_NEEDED) {
            val check = GestureBlueprints.worstRep(list)
            if (check.miss > GestureBlueprints.LIMIT_PERCENT) {
                val used = drops[gesture] ?: 0
                if (used < MAX_DROPS) {
                    list.removeAt(check.index)
                    drops[gesture] = used + 1
                    dropped = true
                } else {
                    inconsistent = true
                }
            }
        }
        // A set that just reached full size may be one too many: forget the oldest.
        while (all.count { it.size >= REPS_NEEDED } > MAX_VERSIONS) all.removeAt(0)
        built = null
        save(context)
        publish()
        return AddResult(list.size, dropped, inconsistent)
    }

    /** The blueprints of each calibrated gesture, oldest first, keyed by the gesture's label. */
    @Synchronized
    fun blueprints(): Map<String, List<GestureBlueprints.Blueprint>> {
        built?.let { return it }
        val result = LinkedHashMap<String, List<GestureBlueprints.Blueprint>>()
        for (gesture in GESTURES) {
            val finished = sets[gesture]?.filter { it.size >= REPS_NEEDED } ?: continue
            if (finished.isNotEmpty()) result[gesture.name] = finished.map { GestureBlueprints.build(it) }
        }
        built = result
        return result
    }

    /** The notes of each gesture that has any, keyed by the gesture's label. */
    @Synchronized
    fun notes(): Map<String, List<Array<DoubleArray>>> = notes.entries.associate { it.key.name to it.value.toList() }

    /**
     * Saves one correction: a movement the user says was [gesture] when the watch said something
     * else. [candidates] holds one clip per strong stroke, loudest first, and must not be empty.
     *
     * Corrections wait in a pile. When the pile reaches [REPS_NEEDED] it is checked like a
     * calibration (the least typical one is dropped if it would not be recognised from the
     * rest, up to [MAX_DROPS] times) and then becomes one more set of the gesture.
     */
    @Synchronized
    fun addCorrection(context: Context, gesture: Gesture, candidates: List<Array<DoubleArray>>): CorrectionResult {
        load(context)
        val pile = corrections.getOrPut(gesture) { ArrayList() }
        // The first correction is centred like the blueprints the gesture already has, the rest like the pile.
        val chosen = if (pile.isEmpty()) bestFit(gesture, candidates) else GestureBlueprints.chooseClip(candidates, pile)
        pile.add(candidates[chosen])
        var became = false
        if (pile.size >= REPS_NEEDED) {
            val check = GestureBlueprints.worstRep(pile)
            val used = correctionDrops[gesture] ?: 0
            if (check.miss > GestureBlueprints.LIMIT_PERCENT && used < MAX_DROPS) {
                pile.removeAt(check.index)
                correctionDrops[gesture] = used + 1
            } else {
                val all = sets.getOrPut(gesture) { ArrayList() }
                // Keep a set that is still being calibrated at the end of the list.
                val at = if (all.isNotEmpty() && all[all.size - 1].size < REPS_NEEDED) all.size - 1 else all.size
                all.add(at, ArrayList(pile))
                while (all.count { it.size >= REPS_NEEDED } > MAX_VERSIONS) all.removeAt(0)
                corrections.remove(gesture)
                correctionDrops.remove(gesture)
                became = true
            }
        }
        built = null
        save(context)
        publish()
        return CorrectionResult(corrections[gesture]?.size ?: 0, became, versionCount(gesture))
    }

    /** The candidate that comes closest to a blueprint [gesture] already has. The loudest when it has none. */
    private fun bestFit(gesture: Gesture, candidates: List<Array<DoubleArray>>): Int {
        val known = blueprints()[gesture.name] ?: return 0
        var best = 0
        var bestValue = Double.POSITIVE_INFINITY
        for (c in candidates.indices) {
            for (blueprint in known) {
                val value = GestureBlueprints.eigenDistance(candidates[c], blueprint).distance
                if (value < bestValue) {
                    bestValue = value
                    best = c
                }
            }
        }
        return best
    }

    /**
     * Saves one note: [clip] is a movement the watch took for [gesture] and the user says was
     * nothing. It starts to count once [GestureBlueprints.NOTES_NEEDED] notes of the gesture are alike.
     */
    @Synchronized
    fun addNote(context: Context, gesture: Gesture, clip: Array<DoubleArray>): NoteResult {
        load(context)
        val list = notes.getOrPut(gesture) { ArrayList() }
        list.add(clip)
        while (list.size > MAX_NOTES) list.removeAt(0)
        save(context)
        return NoteResult(list.size, GestureBlueprints.activeNotes(list).any { it === clip })
    }

    /**
     * Forgets the notes of [gesture] that [clip] looks like, and returns how many there were.
     * Used when the watch ignored a movement because of a note and the user says it was real.
     */
    @Synchronized
    fun removeNotesLike(context: Context, gesture: Gesture, clip: Array<DoubleArray>): Int {
        load(context)
        val list = notes[gesture] ?: return 0
        val before = list.size
        list.removeAll { note ->
            GestureBlueprints.distance(clip, note).distance <= GestureBlueprints.LIMIT_PERCENT * GestureBlueprints.size(note)
        }
        if (list.isEmpty()) notes.remove(gesture)
        if (list.size != before) save(context)
        return before - list.size
    }

    /**
     * Starts a new set for [gesture], so it can be calibrated again. The finished sets are kept
     * and Classify goes on using them. A set that was still being calibrated is started over.
     */
    @Synchronized
    fun startNewVersion(context: Context, gesture: Gesture) {
        load(context)
        val all = sets.getOrPut(gesture) { ArrayList() }
        if (all.isNotEmpty() && all[all.size - 1].size < REPS_NEEDED) all[all.size - 1].clear() else all.add(ArrayList())
        drops.remove(gesture)
        built = null
        save(context)
        publish()
    }

    /** Forgets every set, correction and note of [gesture], or of every gesture when it is null. */
    @Synchronized
    fun forget(context: Context, gesture: Gesture? = null) {
        load(context)
        if (gesture == null) {
            sets.clear()
            drops.clear()
            corrections.clear()
            correctionDrops.clear()
            notes.clear()
        } else {
            sets.remove(gesture)
            drops.remove(gesture)
            corrections.remove(gesture)
            correctionDrops.remove(gesture)
            notes.remove(gesture)
        }
        built = null
        save(context)
        publish()
    }

    private fun publish() {
        _progress.value = GESTURES.associateWith { reps(it) }
        _versions.value = GESTURES.associateWith { versionCount(it) }
    }

    private fun save(context: Context) {
        try {
            val gestures = JSONObject()
            for (gesture in GESTURES) {
                val entry = JSONObject()
                sets[gesture]?.let { all ->
                    val stored = JSONArray()
                    for (list in all) stored.put(clipsToJson(list))
                    entry.put("sets", stored)
                }
                corrections[gesture]?.let { entry.put("corrections", clipsToJson(it)) }
                notes[gesture]?.let { entry.put("notes", clipsToJson(it)) }
                if (entry.length() > 0) gestures.put(gesture.name, entry)
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

    private fun clipsToJson(list: List<Array<DoubleArray>>): JSONArray {
        val reps = JSONArray()
        for (clip in list) reps.put(toJson(clip))
        return reps
    }

    /** One set of reps: a list of flat clips. A clip of the wrong length is skipped. */
    private fun clipsFromJson(reps: JSONArray): MutableList<Array<DoubleArray>> {
        val list = ArrayList<Array<DoubleArray>>()
        for (r in 0 until reps.length()) {
            fromJson(reps.getJSONArray(r))?.let { list.add(it) }
        }
        return list
    }

    private fun fromJson(flat: JSONArray): Array<DoubleArray>? {
        if (flat.length() != 3 * MotionClip.CLIP_LEN) return null
        return Array(3) { axis ->
            DoubleArray(MotionClip.CLIP_LEN) { i -> flat.getDouble(axis * MotionClip.CLIP_LEN + i) }
        }
    }
}
