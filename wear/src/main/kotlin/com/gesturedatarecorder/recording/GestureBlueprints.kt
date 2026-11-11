package com.gesturedatarecorder.recording

import kotlin.math.sqrt

/**
 * Kotlin port of steps 4 to 6 of ML/blueprint_reference.py, plus the "learning over time" update:
 * average a few clips of a gesture into a blueprint, measure how far a new clip is from each
 * blueprint, and pick the closest one or decide it is no known gesture.
 *
 * The Python file is the source of truth. Any change there must be mirrored here (and the other
 * way round). GestureBlueprintsParityTest checks the two against each other on real recordings.
 * The arithmetic below follows the Python operation by operation, including the order numbers
 * are added in.
 *
 * A clip is `clip[axis][reading]`: 3 axes of [MotionClip.CLIP_LEN] gyroscope readings, as made by
 * [MotionClip.extract]. No Android classes are used here, so this runs in plain JVM unit tests.
 */
object GestureBlueprints {
    /** When comparing, try sliding the clip by -SLIDE..+SLIDE readings (100 ms each way). */
    const val SLIDE = 5

    /**
     * "Close enough" rule: a clip counts as a gesture only if it misses that gesture's blueprint
     * by no more than this fraction of the blueprint's own size. Measuring the miss against the
     * size of the gesture keeps "close" meaning the same thing for a small flick and a big twist.
     */
    const val LIMIT_PERCENT = 1.0

    /**
     * One person's typical version of one gesture.
     *
     * [mean] is the typical clip, [count] is how many reps went into it, and [size] is how big
     * the gesture is in rad/s (the root of the mean square of [mean]).
     */
    class Blueprint(val mean: Array<DoubleArray>, val count: Int, val size: Double)

    /** How well a clip fits a blueprint: the smallest [distance] and the [shift] that gave it. */
    class Fit(val distance: Double, val shift: Int)

    /** The decision for one clip. [gesture] is null when it is no known gesture. */
    class Match(val gesture: String?, val distance: Double)

    /**
     * The clip moved later by [shift] readings (earlier when negative). Readings that slide in
     * from outside repeat the edge value.
     */
    fun shifted(clip: Array<DoubleArray>, shift: Int): Array<DoubleArray> {
        val length = clip[0].size
        val last = length - 1
        val out = Array(clip.size) { DoubleArray(length) }
        for (i in 0 until length) {
            val source = (i - shift).coerceIn(0, last)
            for (axis in clip.indices) out[axis][i] = clip[axis][source]
        }
        return out
    }

    /** Root of the mean squared difference over every number in the two clips, in rad/s. */
    fun rmsDifference(a: Array<DoubleArray>, b: Array<DoubleArray>): Double {
        var total = 0.0
        for (axis in a.indices) {
            for (i in a[axis].indices) {
                val difference = a[axis][i] - b[axis][i]
                total += difference * difference
            }
        }
        return sqrt(total / (a.size * a[0].size))
    }

    /**
     * Step 5. Smallest RMS difference between the clip and a blueprint's mean, over shifts of
     * -[SLIDE]..+[SLIDE] readings. The earliest shift wins a tie.
     */
    fun distance(clip: Array<DoubleArray>, mean: Array<DoubleArray>): Fit {
        var best = Double.POSITIVE_INFINITY
        var bestShift = 0
        for (shift in -SLIDE..SLIDE) {
            val value = rmsDifference(shifted(clip, shift), mean)
            if (value < best) {
                best = value
                bestShift = shift
            }
        }
        return Fit(best, bestShift)
    }

    /** How big a gesture is: the root of the mean square of its typical clip, in rad/s. */
    fun size(mean: Array<DoubleArray>): Double {
        var total = 0.0
        for (axis in mean.indices) {
            for (i in mean[axis].indices) total += mean[axis][i] * mean[axis][i]
        }
        return sqrt(total / (mean.size * mean[0].size))
    }

    /**
     * Step 4. Averages a few clips of the same gesture into a blueprint.
     *
     * Each clip is first slid to line up with the others: start from the first clip, line
     * everything up with it, average, then line up with that average and average again.
     * [clips] must not be empty.
     */
    fun build(clips: List<Array<DoubleArray>>): Blueprint {
        require(clips.isNotEmpty()) { "A blueprint needs at least one clip" }
        var reference = clips[0]
        repeat(2) {
            val aligned = clips.map { clip -> shifted(clip, distance(clip, reference).shift) }
            reference = average(aligned)
        }
        return Blueprint(reference, clips.size, size(reference))
    }

    /** Folds one more confirmed rep into a blueprint (learning over time). */
    fun update(blueprint: Blueprint, clip: Array<DoubleArray>): Blueprint {
        val aligned = shifted(clip, distance(clip, blueprint.mean).shift)
        val count = blueprint.count + 1
        val mean = Array(blueprint.mean.size) { axis ->
            DoubleArray(blueprint.mean[axis].size) { i ->
                blueprint.mean[axis][i] + (aligned[axis][i] - blueprint.mean[axis][i]) / count
            }
        }
        return Blueprint(mean, count, size(mean))
    }

    /**
     * Step 6. Picks the closest blueprint.
     *
     * [blueprints] maps a gesture name to its blueprint. The result's gesture is null when [clip]
     * is null (the wrist was quiet), when there are no blueprints, or when [useLimit] is on and
     * the clip misses the closest blueprint by more than [LIMIT_PERCENT] of that blueprint's size.
     */
    fun classify(clip: Array<DoubleArray>?, blueprints: Map<String, Blueprint>, useLimit: Boolean = true): Match {
        if (clip == null || blueprints.isEmpty()) return Match(null, Double.POSITIVE_INFINITY)
        var bestName: String? = null
        var best = Double.POSITIVE_INFINITY
        // Sorted names, like Python's sorted(): the first name wins a tie.
        for (name in blueprints.keys.sorted()) {
            val value = distance(clip, blueprints.getValue(name).mean).distance
            if (value < best) {
                best = value
                bestName = name
            }
        }
        val winner = bestName ?: return Match(null, best)
        if (useLimit && best > LIMIT_PERCENT * blueprints.getValue(winner).size) return Match(null, best)
        return Match(winner, best)
    }

    /** Adds the clips number by number, in order, then divides by how many there are. */
    private fun average(clips: List<Array<DoubleArray>>): Array<DoubleArray> {
        val total = Array(clips[0].size) { DoubleArray(clips[0][0].size) }
        for (clip in clips) {
            for (axis in total.indices) {
                for (i in total[axis].indices) total[axis][i] = total[axis][i] + clip[axis][i]
            }
        }
        for (axis in total.indices) {
            for (i in total[axis].indices) total[axis][i] = total[axis][i] / clips.size
        }
        return total
    }
}
