package com.gesturedatarecorder.recording

import kotlin.math.sqrt

/**
 * Kotlin port of steps 0 to 3 of ML/blueprint_reference.py: put the gyroscope readings on an
 * even grid, measure how hard the wrist is turning, find where that peaks, and cut a short clip
 * around the peak. When a second stroke is nearly as loud as the peak, a clip is cut around that
 * stroke too, and the blueprints decide which clip fits (see [findHumps]).
 *
 * The Python file is the source of truth. Any change there must be mirrored here (and the other
 * way round), or the watch and the laptop stop agreeing. MotionClipParityTest checks them against
 * each other on real recordings. The arithmetic below follows the Python operation by operation,
 * including the order numbers are added in.
 *
 * Only the gyroscope is used. The accelerometer measures gravity, so it records the resting angle
 * of the arm, and the first model learned that angle instead of the gesture.
 *
 * No Android classes are used here, so this runs in plain JVM unit tests.
 */
object MotionClip {
    /** Readings per second on the even grid. */
    const val RATE_HZ = 50

    /** Time between grid points: 20 ms. */
    const val STEP_NS = 1_000_000_000L / RATE_HZ

    /** The motion level averages this many readings (140 ms). */
    const val SMOOTH = 7

    /** rad/s. If the motion level never reaches this, the wrist was quiet: no gesture. */
    const val THRESHOLD = 1.0

    /** Readings kept on each side of the peak. */
    const val HALF = 30

    /** Clip length: 60 readings = 1.2 s. */
    const val CLIP_LEN = 2 * HALF

    /** A stroke is "strong" when its motion level reaches this share of the peak. */
    const val HUMP_SHARE = 0.6

    /** Readings. Strokes closer together than this (160 ms) count as one. */
    const val HUMP_GAP = 8

    /** At most this many strokes are tried per window. */
    const val MAX_HUMPS = 3

    /**
     * What [extract] found.
     *
     * [clip] is `clip[axis][reading]` with 3 axes and [CLIP_LEN] readings, or null when there was
     * too little data or the wrist stayed quiet. It is centred on the loudest stroke.
     *
     * [humps] lists the reading of every strong stroke, loudest first, and [clips] holds one clip
     * per stroke in the same order, so `clips[0]` is [clip]. Both are empty when [clip] is null.
     */
    class Extraction(
        val clip: Array<DoubleArray>?,
        val peakIndex: Int,
        val peakLevel: Double,
        val humps: IntArray = IntArray(0),
        val clips: List<Array<DoubleArray>> = emptyList()
    )

    /** Steps 0 to 3 in one call. */
    fun extract(events: List<SensorEventRecord>): Extraction {
        val gyro = resample(events)
        if (gyro[0].size < 2) return Extraction(null, 0, 0.0)
        val level = motionLevel(gyro)
        val peakIndex = findAction(level)
        val peakLevel = level[peakIndex]
        if (peakLevel < THRESHOLD) return Extraction(null, peakIndex, peakLevel)
        val humps = findHumps(level)
        val clips = humps.map { crop(gyro, it) }
        return Extraction(clips[0], peakIndex, peakLevel, humps, clips)
    }

    /**
     * Step 0. Puts the gyroscope events on an even 50 Hz grid by straight-line interpolation.
     *
     * The watch delivers readings at slightly uneven times. Everything after this function can
     * assume readings are exactly 20 ms apart. Returns `grid[axis][reading]`, with zero readings
     * when there are fewer than two usable events.
     */
    fun resample(events: List<SensorEventRecord>): Array<DoubleArray> {
        // sortedBy is stable, like Python's sorted(): events sharing a time keep their order.
        val ordered = events.filter { it.kind == SensorKind.GYROSCOPE }.sortedBy { it.timestampNs }
        val times = ArrayList<Long>(ordered.size)
        val values = ArrayList<DoubleArray>(ordered.size)
        for (event in ordered) {
            // The same instant twice: keep the first.
            if (times.isNotEmpty() && event.timestampNs <= times[times.size - 1]) continue
            times.add(event.timestampNs)
            values.add(doubleArrayOf(csvValue(event.x), csvValue(event.y), csvValue(event.z)))
        }
        if (times.size < 2) return Array(3) { DoubleArray(0) }

        val start = times[0]
        val count = ((times[times.size - 1] - start) / STEP_NS + 1).toInt()
        val grid = Array(3) { DoubleArray(count) }
        var right = 1 // index of the first event at or after the grid time
        for (k in 0 until count) {
            val t = start + k * STEP_NS
            while (times[right] < t) right++
            val left = right - 1
            val fraction = (t - times[left]).toDouble() / (times[right] - times[left]).toDouble()
            for (axis in 0..2) {
                val a = values[left][axis]
                val b = values[right][axis]
                grid[axis][k] = a + fraction * (b - a)
            }
        }
        return grid
    }

    /**
     * Step 1. How hard the wrist is turning at each reading, in rad/s.
     *
     * Square the three axes, add them, average over [SMOOTH] readings centred on the current one,
     * take the square root. Readings past either end count as zero.
     */
    fun motionLevel(gyro: Array<DoubleArray>): DoubleArray {
        val count = gyro[0].size
        val energy = DoubleArray(count)
        for (t in 0 until count) {
            val x = gyro[0][t]
            val y = gyro[1][t]
            val z = gyro[2][t]
            energy[t] = x * x + y * y + z * z
        }
        val reach = SMOOTH / 2
        val level = DoubleArray(count)
        for (t in 0 until count) {
            var total = 0.0
            for (k in t - reach..t + reach) {
                if (k in 0 until count) total += energy[k]
            }
            level[t] = sqrt(total / SMOOTH)
        }
        return level
    }

    /** Step 2. Index of the highest motion level. The first reading wins a tie. */
    fun findAction(level: DoubleArray): Int {
        var peakIndex = 0
        var peakLevel = -1.0
        for (t in level.indices) {
            if (level[t] > peakLevel) {
                peakLevel = level[t]
                peakIndex = t
            }
        }
        return peakIndex
    }

    /**
     * The readings where a strong stroke peaks, loudest first.
     *
     * The first entry is always the peak that [findAction] returns. Another reading joins the list
     * when it is the highest within [HUMP_GAP] readings on either side (the earlier reading wins a
     * tie) and reaches at least [HUMP_SHARE] of the peak. At most [MAX_HUMPS] are returned.
     *
     * Why this exists: a clip centred on the single loudest reading works when a gesture has one
     * dominant stroke (a twist, a flick). A gesture with two strokes of about the same strength
     * (a shake: left, then right) makes "the loudest" a coin flip, and the clip lands a third of
     * a second apart from one rep to the next. Instead of guessing, one clip is cut per strong
     * stroke and the blueprints decide which one fits ([GestureBlueprints.classifyClips]).
     */
    fun findHumps(level: DoubleArray): IntArray {
        val count = level.size
        if (count == 0) return IntArray(0)
        val cutoff = HUMP_SHARE * level[findAction(level)]
        val humps = ArrayList<Int>()
        for (t in 0 until count) {
            val value = level[t]
            if (value < cutoff) continue
            var highest = true
            for (k in maxOf(0, t - HUMP_GAP)..minOf(count - 1, t + HUMP_GAP)) {
                if (k < t && level[k] >= value) highest = false
                if (k > t && level[k] > value) highest = false
            }
            if (highest) humps.add(t)
        }
        // Loudest first, and the earlier reading wins a tie, like Python's sort on (-level, index).
        humps.sortWith(compareByDescending<Int> { level[it] }.thenBy { it })
        return humps.take(MAX_HUMPS).toIntArray()
    }

    /**
     * Step 3. Cuts [CLIP_LEN] readings centred on the peak. Near an edge of the window, the
     * missing readings repeat the edge value.
     */
    fun crop(gyro: Array<DoubleArray>, peakIndex: Int): Array<DoubleArray> {
        val last = gyro[0].size - 1
        val clip = Array(3) { DoubleArray(CLIP_LEN) }
        for (i in 0 until CLIP_LEN) {
            val source = (peakIndex - HALF + i).coerceIn(0, last)
            for (axis in 0..2) clip[axis][i] = gyro[axis][source]
        }
        return clip
    }

    /**
     * The value as Python reads it from the CSV. The recorder writes floats as text and Python
     * parses that text as a double, so going through the text form gives the identical number.
     */
    private fun csvValue(value: Float): Double = value.toString().toDouble()
}
