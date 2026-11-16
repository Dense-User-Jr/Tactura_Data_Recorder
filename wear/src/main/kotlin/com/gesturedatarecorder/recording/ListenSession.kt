package com.gesturedatarecorder.recording

import java.util.Locale

/**
 * One run of Listen mode: every gyro event goes in, and a [Heard] comes out each time the
 * [MotionGate] finds a burst of movement. The burst is classified against the blueprints and
 * notes the session started with, exactly as a Classify window is.
 *
 * The raw events and every decision are kept, so the whole session can be saved and replayed
 * on the laptop through the Python gate.
 */
class ListenSession(
    private val blueprints: Map<String, List<GestureBlueprints.Blueprint>>,
    private val notes: Map<String, List<Array<DoubleArray>>>
) {
    companion object {
        /** Raw events kept for the log: 20 minutes of both sensors at 50 Hz. Listening goes on after that, unlogged. */
        const val MAX_EVENTS = 120_000

        /** How many words the Listen screen offers at once. */
        const val WORDS_SHOWN = 3
    }

    /**
     * One burst the gate found. [match] is null when the burst was too long to be a gesture.
     * [clips] is how many strong strokes it had.
     */
    class Heard(
        val start: Long,
        val last: Long,
        val tooLong: Boolean,
        val clips: Int,
        val match: GestureBlueprints.VersionMatch?
    ) {
        /** The gesture's label, or null when the burst was not a known gesture. */
        val gesture: String? get() = match?.gesture

        /** How close it came, as in Classify: 1 is a perfect fit. 0 when it was not a gesture. */
        val matchShare: Double
            get() {
                val found = match ?: return 0.0
                if (found.gesture == null || found.size <= 0.0) return 0.0
                return (1.0 - found.distance / found.size).coerceIn(0.0, 1.0)
            }
    }

    private val gate = MotionGate()
    private val cursor = TiltCursor()
    private var cursorAt = -1

    private val fist = FistDetector()
    private var fistFelt = false
    private var lastEventNs = 0L

    /** Gestures named while a jolt was being judged. They are passed on if it was no fist, and dropped if it was. */
    private val held = ArrayList<Heard>()

    /** Something that happened at a moment of the stream: the watch buzzed, or a jolt was judged. */
    private class Marker(val what: String, val atNs: Long, val detail: String = "")
    private val events = ArrayList<SensorEventRecord>(4096)

    /** The decisions log, in order: a [Heard] for each burst, a [Spelled] for each chosen word or undo, a [Marker] for each buzz and jolt. */
    private val log = ArrayList<Any>()

    /** A finished word: the gesture [digits] that were made, and the [word] found (null for none). */
    private class Spelled(val digits: String, val word: String?)

    /** Words found so far. */
    @get:Synchronized
    var wordCount = 0
        private set

    /** Gestures named so far. */
    @get:Synchronized
    var gestureCount = 0
        private set

    /**
     * One gyro event from the watch. Returns what was heard because of it, almost always nothing.
     *
     * Closing the hand can also look like a small gesture. So a gesture that is named while a
     * jolt is being judged waits: it is returned later if the jolt was no fist, and dropped if
     * it was. Ask [takeFist] after each call.
     */
    @Synchronized
    fun push(event: SensorEventRecord): List<Heard> {
        if (events.size < MAX_EVENTS) events.add(event)
        lastEventNs = event.timestampNs
        val out = ArrayList<Heard>(0)
        val since = fist.pendingSince
        when (fist.gyro(event.timestampNs, event.x.toDouble(), event.y.toDouble(), event.z.toDouble())) {
            FistDetector.Outcome.FIST -> {
                fistFelt = true
                log.add(Marker("FIST", since, "dropped ${held.size}"))
                held.clear()
            }
            FistDetector.Outcome.NOT_A_FIST -> {
                log.add(Marker("JOLT", since))
                out.addAll(held)
                held.clear()
            }
            null -> Unit
        }
        for (burst in gate.push(event)) {
            val gyro = burst.gyro
            val heard = if (gyro == null) {
                Heard(burst.start, burst.last, true, 0, null)
            } else {
                val clips = MotionClip.clipsOf(gyro)
                Heard(burst.start, burst.last, false, clips.size, GestureBlueprints.classifyVersions(clips, blueprints, notes = notes))
            }
            log.add(heard)
            if (fist.pending && heard.gesture != null) held.add(heard) else out.add(heard)
        }
        gestureCount += out.count { it.gesture != null }
        return out
    }

    /** True once after the hand closed into a fist. */
    @Synchronized
    fun takeFist(): Boolean {
        val felt = fistFelt
        fistFelt = false
        return felt
    }

    /**
     * Notes in the log that the watch is about to buzz for [durationMs]. Its own buzz shakes
     * the accelerometer, though not nearly as hard as a fist, so this is only for the record.
     */
    @Synchronized
    fun noteBuzz(durationMs: Long) {
        log.add(Marker("BUZZ", lastEventNs, durationMs.toString()))
    }

    /**
     * One accelerometer event from the watch. Moves the tilt cursor among [options] words and
     * returns the word it is on, or -1 for none. While the wrist is moving fast the cursor
     * stays where it was: a gesture shakes the accelerometer and must not move it.
     */
    @Synchronized
    fun pushAccel(event: SensorEventRecord, axis: TiltCursor.Axis, options: Int): Int {
        if (events.size < MAX_EVENTS) events.add(event)
        lastEventNs = event.timestampNs
        // A fist only means something while there are words to choose.
        fist.accel(event.timestampNs, event.x.toDouble(), event.y.toDouble(), event.z.toDouble(), options > 0)
        cursor.push(event.x.toDouble(), event.y.toDouble(), event.z.toDouble())
        // Closing the hand tilts the wrist a little. While a jolt is judged the cursor stays on the word it was on.
        if (fist.pending) return cursorAt
        if (!gate.moving || options <= 0 || axis == TiltCursor.Axis.OFF) cursorAt = cursor.update(axis, options)
        return cursorAt
    }

    /** The words on offer changed: the cursor goes back to the first one, measured from the tilt the wrist settles at. */
    @Synchronized
    fun rezeroCursor() {
        cursor.rezero()
    }

    /** Notes in the log that the user chose [word] after making the gestures [labels]. */
    @Synchronized
    fun logWord(labels: List<String>, word: String) {
        log.add(Spelled(Lexicon.key(labels).orEmpty(), word))
        wordCount++
    }

    /** Notes in the log that the user took back a gesture, leaving [labels]. */
    @Synchronized
    fun logUndo(labels: List<String>) {
        log.add(Spelled(Lexicon.key(labels).orEmpty(), null))
    }

    /** The raw gyro and accelerometer events of the session in the recorder's CSV format. */
    @Synchronized
    fun streamCsv(): String = CaptureCsv.build("LISTEN", events)

    /**
     * One line per burst: where it was in the stream and what the watch decided. What the user
     * tapped is a line too, in its place among the bursts: `WORD:<word>` for a chosen word, with
     * the gesture digits made for it in `nearest`, and `UNDO` with the digits that were left.
     * `FIST`, `JOLT` (a jolt that was no fist) and `BUZZ` (the watch's own buzz, with its length
     * in ms in `nearest`) carry the sensor time they happened at in `at_ns`.
     */
    @Synchronized
    fun decisionsCsv(): String {
        val out = StringBuilder("start,last,too_long,decision,match_percent,version,nearest,ignored_by_note,clips,at_ns\n")
        for (entry in log) {
            if (entry is Spelled) {
                out.append("-1,-1,false,")
                    .append(if (entry.word != null) "WORD:${entry.word}" else "UNDO")
                    .append(",0.0,-1,").append(entry.digits).append(",false,0,\n")
                continue
            }
            if (entry is Marker) {
                out.append("-1,-1,false,").append(entry.what).append(",0.0,-1,").append(entry.detail)
                    .append(",false,0,").append(entry.atNs).append('\n')
                continue
            }
            val item = entry as Heard
            val match = item.match
            out.append(item.start).append(',')
                .append(item.last).append(',')
                .append(item.tooLong).append(',')
                .append(item.gesture ?: "NONE").append(',')
                .append("%.1f".format(Locale.US, 100.0 * item.matchShare)).append(',')
                .append(match?.version ?: -1).append(',')
                .append(match?.nearest ?: "").append(',')
                .append(match?.ignoredByNote ?: false).append(',')
                .append(item.clips).append(",\n")
        }
        return out.toString()
    }

    /** True when the session ran longer than the log holds, so the saved stream is cut short. */
    @Synchronized
    fun logIsFull(): Boolean = events.size >= MAX_EVENTS
}
