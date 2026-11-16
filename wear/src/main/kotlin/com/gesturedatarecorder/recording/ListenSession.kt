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
        /** Raw events kept for the log: 20 minutes at 50 Hz. Listening goes on after that, unlogged. */
        const val MAX_EVENTS = 60_000
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
    private val events = ArrayList<SensorEventRecord>(4096)

    /** The decisions log, in order: a [Heard] for each burst, a [Spelled] for each finished word. */
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

    /** One gyro event from the watch. Returns what was heard because of it, almost always nothing. */
    @Synchronized
    fun push(event: SensorEventRecord): List<Heard> {
        if (events.size < MAX_EVENTS) events.add(event)
        val bursts = gate.push(event)
        if (bursts.isEmpty()) return emptyList()
        val found = bursts.map { burst ->
            val gyro = burst.gyro
            if (gyro == null) {
                Heard(burst.start, burst.last, true, 0, null)
            } else {
                val clips = MotionClip.clipsOf(gyro)
                Heard(burst.start, burst.last, false, clips.size, GestureBlueprints.classifyVersions(clips, blueprints, notes = notes))
            }
        }
        log.addAll(found)
        gestureCount += found.count { it.gesture != null }
        return found
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

    /** The raw gyro events of the session in the recorder's CSV format. */
    @Synchronized
    fun streamCsv(): String = CaptureCsv.build("LISTEN", events)

    /**
     * One line per burst: where it was in the stream and what the watch decided. What the user
     * tapped is a line too, in its place among the bursts: `WORD:<word>` for a chosen word, with
     * the gesture digits made for it in `nearest`, and `UNDO` with the digits that were left.
     */
    @Synchronized
    fun decisionsCsv(): String {
        val out = StringBuilder("start,last,too_long,decision,match_percent,version,nearest,ignored_by_note,clips\n")
        for (entry in log) {
            if (entry is Spelled) {
                out.append("-1,-1,false,")
                    .append(if (entry.word != null) "WORD:${entry.word}" else "UNDO")
                    .append(",0.0,-1,").append(entry.digits).append(",false,0\n")
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
                .append(item.clips).append('\n')
        }
        return out.toString()
    }

    /** True when the session ran longer than the log holds, so the saved stream is cut short. */
    @Synchronized
    fun logIsFull(): Boolean = events.size >= MAX_EVENTS
}
