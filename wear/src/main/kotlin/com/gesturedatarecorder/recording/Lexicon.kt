package com.gesturedatarecorder.recording

import android.content.Context
import android.util.Log

/**
 * The words Tactura can spell: which sequence of gestures gives which word.
 *
 * Each gesture stands for a bin of two phonemes ([Gesture.phonemes]), so a word is a sequence of
 * gestures, and two words can share one sequence ("piece" and "peace", or "to", "do" and
 * "two"). The list comes from `python ML/build_lexicon.py` and is bundled as the asset
 * `lexicon.csv`.
 *
 * This is a plain lookup with no language model and no guessing. For the gestures made so far
 * it gives the words they spell exactly ([exact]) and the words that start with them
 * ([longer]), each most common first. A smarter decoder can replace it later.
 */
object Lexicon {
    private const val TAG = "Lexicon"
    private const val ASSET = "lexicon.csv"

    /** Only the most common words are offered: rarer ones crowd out the word the user meant. */
    const val MAX_RANK = 20_000

    /** The gestures Listen mode can hear: the calibrated ones, and the shoves, which need no calibration. */
    val GESTURES: List<Gesture> = BlueprintStore.GESTURES + ShoveDetector.GESTURES

    /** One character per [Gesture], in the order of the enum. The shoves are 7 up, 8 down, 9 left, 0 right. */
    private const val DIGITS = "1234567890"

    /** One way to spell a word: its gestures as digits ([digit]), and how common the word is. */
    class Entry(val word: String, val zipf: Double, val gestures: String)

    private var entries: List<Entry>? = null

    /** Reads the bundled list once per process. Safe to call again. Call off the main thread the first time. */
    @Synchronized
    fun load(context: Context): List<Entry> {
        entries?.let { return it }
        val result = try {
            context.assets.open(ASSET).bufferedReader().useLines { lines ->
                parse(lines, GESTURES)
            }
        } catch (error: Exception) {
            Log.e(TAG, "Could not read $ASSET; no words will be found", error)
            emptyList()
        }
        entries = result
        return result
    }

    /** A gesture's digit in the list: 1 for the first [Gesture], 2 for the second, and so on, with 0 for the tenth. */
    fun digit(gesture: Gesture): Char = DIGITS[gesture.ordinal]

    /** [labels] as the list's digits, or null when one of them is not a gesture. */
    fun key(labels: List<String>): String? {
        val out = StringBuilder(labels.size)
        for (label in labels) out.append(digit(Gesture.fromLabel(label) ?: return null))
        return out.toString()
    }

    /**
     * Turns the lines of lexicon.csv (`word,rank,zipf,gestures`, after a header) into entries,
     * most common first. Words rarer than [MAX_RANK] and words that need a gesture outside
     * [usable] are left out.
     */
    fun parse(lines: Sequence<String>, usable: List<Gesture>): List<Entry> {
        val digits = usable.map { digit(it) }.toSet()
        val found = ArrayList<Entry>()
        for (line in lines.drop(1)) {
            val cells = line.trim().split(',')
            if (cells.size < 4) continue
            val rank = cells[1].toIntOrNull() ?: continue
            val zipf = cells[2].toDoubleOrNull() ?: continue
            val gestures = cells[3]
            if (rank > MAX_RANK || gestures.isEmpty() || gestures.any { it !in digits }) continue
            found.add(Entry(cells[0], zipf, gestures))
        }
        return found.sortedByDescending { it.zipf }
    }

    /** The words whose gestures are exactly [key], most common first. */
    fun exact(entries: List<Entry>, key: String): List<String> =
        entries.filter { it.gestures == key }.map { it.word }.distinct()

    /**
     * The words that start with the gestures [key] and need more, most common first. Words that
     * [key] already spells exactly are left out, since [exact] lists them.
     */
    fun longer(entries: List<Entry>, key: String): List<String> {
        if (key.isEmpty()) return emptyList()
        val already = exact(entries, key).toSet()
        return entries.filter { it.gestures.length > key.length && it.gestures.startsWith(key) && it.word !in already }
            .map { it.word }
            .distinct()
    }
}
