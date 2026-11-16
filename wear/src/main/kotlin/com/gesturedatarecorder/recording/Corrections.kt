package com.gesturedatarecorder.recording

import android.content.Context
import android.util.Log

/**
 * The **Wrong?** button: the user tells the watch what a movement really was.
 *
 * The clips of the last Classify are kept in memory until they are corrected or the next
 * Classify replaces them. A correction does one of two things:
 *
 * - "It was this gesture": the movement joins that gesture's pile of corrections, and five of
 *   them become one more version of the gesture ([BlueprintStore.addCorrection]).
 * - "It was nothing": the movement becomes a note on the gesture the watch took it for, and
 *   once three notes are alike the watch ignores movements like them ([BlueprintStore.addNote]).
 *
 * Every correction is also written as a small CSV, so the laptop can score the watch later.
 */
object Corrections {
    private const val TAG = "Corrections"

    /** What the last Classify saw ([clips], one per strong stroke) and what it decided. */
    private class Last(
        val clips: List<Array<DoubleArray>>,
        val match: GestureBlueprints.VersionMatch,
        val fileName: String?
    )

    @Volatile
    private var last: Last? = null

    /** Called by the service after each Classify that used blueprints. */
    fun remember(clips: List<Array<DoubleArray>>, match: GestureBlueprints.VersionMatch, fileName: String?) {
        last = Last(clips, match, fileName)
    }

    /** Called when a Classify starts, so an old movement can never be corrected by mistake. */
    fun forget() {
        last = null
    }

    /**
     * Applies the user's correction to the last classified movement and returns a short line
     * for the screen. [truth] is the gesture it really was, or null for "I did nothing".
     * Call off the main thread.
     */
    @Synchronized
    fun apply(context: Context, truth: Gesture?): String {
        val seen = last ?: return "Nothing to correct"
        val said = Gesture.fromLabel(seen.match.gesture)
        if (truth == said) return "That is what it said"
        if (seen.clips.isEmpty()) return "The watch saw no movement, so there is nothing to learn from. Try a bigger move."
        last = null
        val message = if (truth == null) {
            // Only reachable when the watch named a gesture, so there is a deciding clip.
            val note = BlueprintStore.addNote(context, said!!, seen.clips[seen.match.clip])
            if (note.active) {
                "Got it. Movements like this are now ignored."
            } else {
                "Noted. Ignored once it has happened ${GestureBlueprints.NOTES_NEEDED} times."
            }
        } else {
            // The watch ignored it because of a note and the user says it was real: the note was wrong.
            val lifted = if (seen.match.ignoredByNote && seen.match.nearest == truth.name) {
                BlueprintStore.removeNotesLike(context, truth, seen.clips[seen.match.clip])
            } else {
                0
            }
            val added = BlueprintStore.addCorrection(context, truth, seen.clips)
            when {
                added.becameVersion -> "Learned. ${truth.displayName} now has ${added.versions} versions."
                lifted > 0 -> "Got it. The watch stopped ignoring this."
                else -> "Noted. ${truth.displayName} correction ${added.waiting} of ${BlueprintStore.REPS_NEEDED}."
            }
        }
        val saidLabel = seen.match.gesture ?: "NONE"
        val wasLabel = truth?.name ?: "NOTHING"
        val file = CsvStorage.save(
            context,
            CsvStorage.CORRECTIONS_DIR,
            { number -> CsvStorage.correctionName(number, saidLabel, wasLabel, System.currentTimeMillis()) },
            "file,said,was,ignored_by_note\n${seen.fileName.orEmpty()},$saidLabel,$wasLabel,${seen.match.ignoredByNote}\n"
        )
        Log.i(TAG, "Correction: said=$saidLabel was=$wasLabel of ${seen.fileName}: $message file=$file")
        return message
    }
}
