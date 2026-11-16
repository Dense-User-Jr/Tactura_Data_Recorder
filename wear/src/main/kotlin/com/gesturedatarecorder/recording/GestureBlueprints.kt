package com.gesturedatarecorder.recording

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Kotlin port of steps 4 to 6 of ML/blueprint_reference.py, plus the "learning over time" update:
 * average a few clips of a gesture into a blueprint, measure how far a new clip is from each
 * blueprint, and pick the closest one or decide it is no known gesture. A blueprint also learns
 * the main ways the user's reps differ from their average (eigengestures, step 7), and that
 * usual variation is forgiven when a new clip is compared with it.
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
     *
     * It has to stay below 100%: a clip of almost no motion is exactly 100% away from every
     * blueprint, so at 100% a faint twitch could pass as the smallest gesture.
     */
    const val LIMIT_PERCENT = 0.9

    /**
     * "Strong enough" rule. Eigengestures forgive part of the gap between a clip and a blueprint,
     * and for a small gesture that can include most of the gap to no motion at all, so a faint
     * twitch could pass as the smallest gesture. A clip that is close enough only thanks to that
     * forgiveness (its plain distance is over the limit) must therefore also be at least this
     * fraction of the blueprint's size. A clip that is close enough the plain way is accepted
     * whatever its strength, so an honest soft rep is not thrown out.
     */
    const val MIN_STRENGTH = 0.6

    /** Eigengestures kept per blueprint. 0 turns them off. */
    const val EIGEN_DIRECTIONS = 2

    /** Usual variation is forgiven up to this many times the spread seen in calibration. */
    const val EIGEN_CAP = 1.5

    /** A direction holding less than this share of the variation between reps is noise. */
    const val EIGEN_FLOOR = 1e-9

    /** Passes of the eigenvalue solver. A 5 by 5 table settles in under 10. */
    const val JACOBI_SWEEPS = 30

    /**
     * One person's typical version of one gesture.
     *
     * [mean] is the typical clip, [count] is how many reps went into it, and [size] is how big
     * the gesture is in rad/s (the root of the mean square of [mean]).
     *
     * [directions] are the eigengestures: patterns shaped like [mean], each of length 1, that turn
     * the blueprint into one of the user's usual versions of the gesture when added to it or
     * taken from it. [spreads] says how far the reps typically sit along each one. Both are empty
     * for a blueprint built from fewer than 3 reps.
     */
    class Blueprint(
        val mean: Array<DoubleArray>,
        val count: Int,
        val size: Double,
        val directions: List<Array<DoubleArray>> = emptyList(),
        val spreads: DoubleArray = DoubleArray(0)
    )

    /** What [eigengestures] found: the directions, biggest first, and the spread along each. */
    class Eigengestures(val directions: List<Array<DoubleArray>>, val spreads: DoubleArray)

    /** What [jacobi] found: [values]`[i]` is an eigenvalue and column i of [vectors] its eigenvector. */
    class Eigen(val values: DoubleArray, val vectors: Array<DoubleArray>)

    /** How well a clip fits a blueprint: the smallest [distance] and the [shift] that gave it. */
    class Fit(val distance: Double, val shift: Int)

    /** The decision for one clip. [gesture] is null when it is no known gesture. */
    class Match(val gesture: String?, val distance: Double)

    /**
     * The decision when a gesture may have several blueprints. [gesture] is null when it is no
     * known gesture. [size] is the size of the blueprint that decided and [version] its position
     * in that gesture's list (-1 when there was nothing to compare).
     */
    class VersionMatch(val gesture: String?, val distance: Double, val size: Double, val version: Int)

    /** The rep that looks least like the others: its [index], and its [miss] as a fraction of size. */
    class RepCheck(val index: Int, val miss: Double)

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
     * everything up with it, average, then line up with that average and average again. The
     * lined-up clips also give the eigengestures. [clips] must not be empty.
     */
    fun build(clips: List<Array<DoubleArray>>): Blueprint {
        require(clips.isNotEmpty()) { "A blueprint needs at least one clip" }
        var reference = clips[0]
        var aligned = clips
        for (pass in 0 until 2) {
            val target = reference
            aligned = clips.map { clip -> shifted(clip, distance(clip, target).shift) }
            reference = average(aligned)
        }
        val found = eigengestures(aligned, reference)
        return Blueprint(reference, clips.size, size(reference), found.directions, found.spreads)
    }

    /**
     * Eigenvalues and eigenvectors of a small symmetric table (cyclic Jacobi). They are not sorted.
     *
     * The method zeroes one off-diagonal entry at a time by rotating two rows and two columns. It
     * only adds, multiplies, divides and takes square roots, in the same order as the Python
     * reference, so the two give the same numbers.
     */
    fun jacobi(table: Array<DoubleArray>): Eigen {
        val n = table.size
        val a = Array(n) { table[it].copyOf() }
        val v = Array(n) { i -> DoubleArray(n) { j -> if (i == j) 1.0 else 0.0 } }
        for (sweep in 0 until JACOBI_SWEEPS) {
            for (p in 0 until n - 1) {
                for (q in p + 1 until n) {
                    if (a[p][q] == 0.0) continue
                    val theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q])
                    val t = (if (theta >= 0.0) 1.0 else -1.0) / (abs(theta) + sqrt(theta * theta + 1.0))
                    val c = 1.0 / sqrt(t * t + 1.0)
                    val s = t * c
                    for (k in 0 until n) { // columns p and q
                        val akp = a[k][p]
                        val akq = a[k][q]
                        a[k][p] = c * akp - s * akq
                        a[k][q] = s * akp + c * akq
                    }
                    for (k in 0 until n) { // rows p and q
                        val apk = a[p][k]
                        val aqk = a[q][k]
                        a[p][k] = c * apk - s * aqk
                        a[q][k] = s * apk + c * aqk
                    }
                    for (k in 0 until n) {
                        val vkp = v[k][p]
                        val vkq = v[k][q]
                        v[k][p] = c * vkp - s * vkq
                        v[k][q] = s * vkp + c * vkq
                    }
                }
            }
        }
        return Eigen(DoubleArray(n) { a[it][it] }, v)
    }

    /**
     * Step 7. The main ways the reps of one gesture differ from their average.
     *
     * [aligned] holds the reps after lining up and [mean] is their average. Each direction found
     * is a pattern shaped like [mean] with length 1, and its spread is how far the reps typically
     * sit along it.
     *
     * The directions are the top eigenvectors of the covariance of the reps. With n reps there
     * are at most n - 1 of them, so the eigenvalues come from the small n by n table of dot
     * products between reps instead of a 180 by 180 one. Up to [EIGEN_DIRECTIONS] are kept, and
     * fewer than 3 reps give none.
     */
    fun eigengestures(aligned: List<Array<DoubleArray>>, mean: Array<DoubleArray>): Eigengestures {
        val n = aligned.size
        if (EIGEN_DIRECTIONS <= 0 || n < 3) return Eigengestures(emptyList(), DoubleArray(0))
        val axes = mean.size
        val length = mean[0].size
        val deviations = aligned.map { clip ->
            Array(axes) { axis -> DoubleArray(length) { i -> clip[axis][i] - mean[axis][i] } }
        }
        val gram = Array(n) { DoubleArray(n) }
        for (i in 0 until n) {
            for (j in 0 until n) {
                var total = 0.0
                for (axis in 0 until axes) {
                    for (k in 0 until length) total += deviations[i][axis][k] * deviations[j][axis][k]
                }
                gram[i][j] = total
            }
        }
        var trace = 0.0
        for (i in 0 until n) trace += gram[i][i]
        val solved = jacobi(gram)
        // Biggest eigenvalue first, and the lower index wins a tie, like Python's sort on (-value, index).
        val order = (0 until n).sortedWith(compareByDescending<Int> { solved.values[it] }.thenBy { it })
        val directions = ArrayList<Array<DoubleArray>>()
        val spreads = ArrayList<Double>()
        for (index in order) {
            if (directions.size == EIGEN_DIRECTIONS) break
            val value = solved.values[index]
            if (value <= EIGEN_FLOOR * trace) break
            val scale = sqrt(value)
            val direction = Array(axes) { DoubleArray(length) }
            for (rep in 0 until n) {
                val weight = solved.vectors[rep][index]
                for (axis in 0 until axes) {
                    for (k in 0 until length) direction[axis][k] = direction[axis][k] + weight * deviations[rep][axis][k]
                }
            }
            for (axis in 0 until axes) {
                for (k in 0 until length) direction[axis][k] = direction[axis][k] / scale
            }
            directions.add(direction)
            spreads.add(sqrt(value / n))
        }
        return Eigengestures(directions, spreads.toDoubleArray())
    }

    /**
     * How much a clip and a blueprint disagree, after forgiving the user's usual variation.
     *
     * First the clip is lined up with the blueprint the plain way ([distance]). Then what is left
     * over, clip minus mean, is checked against each eigengesture, and the part that follows it
     * is removed, but only up to [EIGEN_CAP] times the spread seen in calibration. A movement far
     * outside the user's habits still counts as different.
     *
     * A blueprint with no directions gives exactly the plain distance.
     */
    fun eigenDistance(clip: Array<DoubleArray>, blueprint: Blueprint): Fit {
        val fit = distance(clip, blueprint.mean)
        if (blueprint.directions.isEmpty()) return fit
        val moved = shifted(clip, fit.shift)
        val mean = blueprint.mean
        val axes = mean.size
        val length = mean[0].size
        val removed = DoubleArray(blueprint.directions.size)
        for (index in blueprint.directions.indices) {
            val direction = blueprint.directions[index]
            var amount = 0.0
            for (axis in 0 until axes) {
                for (i in 0 until length) amount += (moved[axis][i] - mean[axis][i]) * direction[axis][i]
            }
            val limit = EIGEN_CAP * blueprint.spreads[index]
            removed[index] = minOf(maxOf(amount, -limit), limit)
        }
        var total = 0.0
        for (axis in 0 until axes) {
            for (i in 0 until length) {
                var left = moved[axis][i] - mean[axis][i]
                for (index in blueprint.directions.indices) left -= removed[index] * blueprint.directions[index][axis][i]
                total += left * left
            }
        }
        return Fit(sqrt(total / (axes * length)), fit.shift)
    }

    /**
     * Calibration check: which rep looks least like the others?
     *
     * For each rep, builds a blueprint from the other reps and measures how far the rep misses it,
     * as a fraction of that blueprint's size. Returns the rep with the largest miss; the earliest
     * rep wins a tie. A miss above [LIMIT_PERCENT] means that rep would not be recognised from the
     * others. Needs at least 3 clips.
     */
    fun worstRep(clips: List<Array<DoubleArray>>): RepCheck {
        require(clips.size >= 3) { "The calibration check needs at least 3 clips" }
        var worstIndex = 0
        var worstMiss = -1.0
        for (index in clips.indices) {
            val others = clips.filterIndexed { other, _ -> other != index }
            val blueprint = build(others)
            val miss = distance(clips[index], blueprint.mean).distance / blueprint.size
            if (miss > worstMiss) {
                worstMiss = miss
                worstIndex = index
            }
        }
        return RepCheck(worstIndex, worstMiss)
    }

    /**
     * Folds one more confirmed rep into a blueprint (learning over time). The eigengestures are
     * carried over unchanged, because they need the reps themselves and a blueprint only keeps
     * their average.
     */
    fun update(blueprint: Blueprint, clip: Array<DoubleArray>): Blueprint {
        val aligned = shifted(clip, distance(clip, blueprint.mean).shift)
        val count = blueprint.count + 1
        val mean = Array(blueprint.mean.size) { axis ->
            DoubleArray(blueprint.mean[axis].size) { i ->
                blueprint.mean[axis][i] + (aligned[axis][i] - blueprint.mean[axis][i]) / count
            }
        }
        return Blueprint(mean, count, size(mean), blueprint.directions, blueprint.spreads)
    }

    /**
     * Step 6. Picks the closest blueprint.
     *
     * [blueprints] maps a gesture name to its blueprint. The result's gesture is null when [clip]
     * is null (the wrist was quiet), when there are no blueprints, or when [useLimit] is on and
     * the clip misses the closest blueprint by more than [LIMIT_PERCENT] of that blueprint's size,
     * or needed forgiving to get that close and is weaker than [MIN_STRENGTH] of it. The miss is
     * measured with [eigenDistance], so the user's usual variation does not count against them.
     */
    fun classify(clip: Array<DoubleArray>?, blueprints: Map<String, Blueprint>, useLimit: Boolean = true): Match {
        if (clip == null || blueprints.isEmpty()) return Match(null, Double.POSITIVE_INFINITY)
        var bestName: String? = null
        var best = Double.POSITIVE_INFINITY
        // Sorted names, like Python's sorted(): the first name wins a tie.
        for (name in blueprints.keys.sorted()) {
            val value = eigenDistance(clip, blueprints.getValue(name)).distance
            if (value < best) {
                best = value
                bestName = name
            }
        }
        val winner = bestName ?: return Match(null, best)
        if (useLimit && !passes(clip, blueprints.getValue(winner), best)) return Match(null, best)
        return Match(winner, best)
    }

    /**
     * Step 6 when a window has more than one strong stroke: picks the closest blueprint, trying
     * the clip of every stroke.
     *
     * [clips] comes from [MotionClip.Extraction.clips]. Every clip is compared with every
     * blueprint and the single best fit wins. The "close enough" and "strong enough" rules are
     * the same as in [classify], applied to the winning clip. The result's gesture is null for an empty list (the wrist was quiet), for no
     * blueprints, or when nothing is close enough. With one clip this gives exactly what
     * [classify] gives.
     */
    fun classifyClips(clips: List<Array<DoubleArray>>, blueprints: Map<String, Blueprint>, useLimit: Boolean = true): Match {
        if (clips.isEmpty() || blueprints.isEmpty()) return Match(null, Double.POSITIVE_INFINITY)
        var bestName: String? = null
        var bestClip: Array<DoubleArray>? = null
        var best = Double.POSITIVE_INFINITY
        // Sorted names, like Python's sorted(): the first name wins a tie, then the first clip.
        for (name in blueprints.keys.sorted()) {
            val blueprint = blueprints.getValue(name)
            for (clip in clips) {
                val value = eigenDistance(clip, blueprint).distance
                if (value < best) {
                    best = value
                    bestName = name
                    bestClip = clip
                }
            }
        }
        val winner = bestName ?: return Match(null, best)
        val winningClip = bestClip ?: return Match(null, best)
        if (useLimit && !passes(winningClip, blueprints.getValue(winner), best)) return Match(null, best)
        return Match(winner, best)
    }

    /**
     * Calibration: which of a rep's clips to keep. Returns its index in [clips].
     *
     * [clips] comes from [MotionClip.Extraction.clips] for the new rep, and [earlier] holds the
     * clips already kept for the same gesture. With no earlier reps the first clip is kept (the
     * one centred on the loudest stroke). Otherwise the clip closest to the blueprint of the
     * earlier reps is kept, so every rep of a two-stroke gesture ends up centred on the same
     * stroke. The first clip wins a tie. [clips] must not be empty.
     */
    fun chooseClip(clips: List<Array<DoubleArray>>, earlier: List<Array<DoubleArray>>): Int {
        require(clips.isNotEmpty()) { "A rep needs at least one clip" }
        if (earlier.isEmpty() || clips.size == 1) return 0
        val mean = build(earlier).mean
        var bestIndex = 0
        var best = Double.POSITIVE_INFINITY
        for (index in clips.indices) {
            val value = distance(clips[index], mean).distance
            if (value < best) {
                best = value
                bestIndex = index
            }
        }
        return bestIndex
    }

    /**
     * Step 6 when a gesture may have several blueprints.
     *
     * [versions] maps a gesture name to its blueprints, oldest first: one for each time the user
     * calibrated that gesture. People do not do a small gesture the same way from one sitting to
     * the next, so the watch keeps the earlier blueprints instead of replacing them.
     *
     * Every clip is compared with every blueprint of every gesture, and the single best fit
     * decides. The "close enough" and "strong enough" rules are then applied to that one
     * blueprint, exactly as in [classifyClips]. Another blueprint of the same gesture is not
     * given a second chance, because that let more random movement through in testing.
     *
     * With one blueprint per gesture this decides exactly like [classifyClips].
     */
    fun classifyVersions(
        clips: List<Array<DoubleArray>>,
        versions: Map<String, List<Blueprint>>,
        useLimit: Boolean = true
    ): VersionMatch {
        var bestName: String? = null
        var bestClip: Array<DoubleArray>? = null
        var bestBlueprint: Blueprint? = null
        var bestVersion = -1
        var best = Double.POSITIVE_INFINITY
        // Sorted names, like Python's sorted(): the first name wins a tie, then the older blueprint, then the first clip.
        for (name in versions.keys.sorted()) {
            val list = versions.getValue(name)
            for (index in list.indices) {
                for (clip in clips) {
                    val value = eigenDistance(clip, list[index]).distance
                    if (value < best) {
                        best = value
                        bestName = name
                        bestClip = clip
                        bestBlueprint = list[index]
                        bestVersion = index
                    }
                }
            }
        }
        val winner = bestName ?: return VersionMatch(null, best, 0.0, -1)
        val winningClip = bestClip ?: return VersionMatch(null, best, 0.0, -1)
        val winningBlueprint = bestBlueprint ?: return VersionMatch(null, best, 0.0, -1)
        if (useLimit && !passes(winningClip, winningBlueprint, best)) {
            return VersionMatch(null, best, winningBlueprint.size, bestVersion)
        }
        return VersionMatch(winner, best, winningBlueprint.size, bestVersion)
    }

    /** The "close enough" and "strong enough" rules for the winning clip and blueprint. */
    private fun passes(clip: Array<DoubleArray>, blueprint: Blueprint, eigenMiss: Double): Boolean {
        val limit = LIMIT_PERCENT * blueprint.size
        if (eigenMiss > limit) return false // not close enough, even after forgiving the usual variation
        if (distance(clip, blueprint.mean).distance <= limit) return true // close enough the plain way
        return size(clip) >= MIN_STRENGTH * blueprint.size // needed forgiving: must be strong enough
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
