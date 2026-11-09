package com.gesturedatarecorder.recording

/**
 * Kotlin port of `recording_features()` in ML/train_gesture_classifier.py.
 *
 * The Python function is the source of truth; any change there must be mirrored here
 * (and vice versa), or the on-watch model sees different inputs than it was trained on.
 * The port reproduces the Python arithmetic operation by operation so the features match
 * bit for bit:
 *  - values are taken from their CSV text form (`Float.toString().toDouble()`), as Python
 *    parses them from the CSV;
 *  - event time = timestamp_ns / 1e6 as a double; start = min over both sensors,
 *    duration = max - start;
 *  - per channel: stable sort by time, average samples sharing a time (np.unique + bincount),
 *    normalize to [0, 1], then np.interp onto np.linspace(0, 1, TIME_BINS), clamped at the ends;
 *  - channel order accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z.
 */
object GestureFeatures {
    const val TIME_BINS = 32
    const val FEATURE_COUNT = 6 * TIME_BINS

    /** Returns null when either sensor has no samples (the Python code raises in that case). */
    fun extract(events: List<SensorEventRecord>): FloatArray? {
        val accel = events.filter { it.kind == SensorKind.ACCELEROMETER }
        val gyro = events.filter { it.kind == SensorKind.GYROSCOPE }
        if (accel.isEmpty() || gyro.isEmpty()) return null

        var startMs = Double.POSITIVE_INFINITY
        var endMs = Double.NEGATIVE_INFINITY
        for (event in events) {
            val t = eventTimeMs(event)
            if (t < startMs) startMs = t
            if (t > endMs) endMs = t
        }
        val durationMs = endMs - startMs
        val grid = linspace01(TIME_BINS)

        val features = FloatArray(FEATURE_COUNT)
        var offset = 0
        for (samples in listOf(accel, gyro)) {
            for (component in 0..2) {
                val resampled = resampleChannel(samples, component, startMs, durationMs, grid)
                for (value in resampled) features[offset++] = value.toFloat()
            }
        }
        return features
    }

    private fun eventTimeMs(event: SensorEventRecord): Double = event.timestampNs / 1_000_000.0

    private fun csvValue(event: SensorEventRecord, component: Int): Double = when (component) {
        0 -> event.x
        1 -> event.y
        else -> event.z
    }.toString().toDouble()

    private fun resampleChannel(
        samples: List<SensorEventRecord>,
        component: Int,
        startMs: Double,
        durationMs: Double,
        grid: DoubleArray
    ): DoubleArray {
        // Stable sort by time, like Python's list.sort with a time key.
        val sorted = samples.map { eventTimeMs(it) to csvValue(it, component) }.sortedBy { it.first }

        // np.unique + bincount: one point per distinct (t - start), value = mean, summed in order.
        val times = ArrayList<Double>(sorted.size)
        val values = ArrayList<Double>(sorted.size)
        var index = 0
        while (index < sorted.size) {
            val time = sorted[index].first - startMs
            var sum = 0.0
            var count = 0
            while (index < sorted.size && sorted[index].first - startMs == time) {
                sum += sorted[index].second
                count++
                index++
            }
            times += time
            values += if (count == 1) sum else sum / count
        }

        val xp = DoubleArray(times.size) { if (durationMs > 0) times[it] / durationMs else 0.0 }
        val fp = values.toDoubleArray()
        return DoubleArray(grid.size) { interp(grid[it], xp, fp) }
    }

    /** np.linspace(0.0, 1.0, num): i * step, with the last point set to exactly 1.0. */
    private fun linspace01(num: Int): DoubleArray {
        val step = 1.0 / (num - 1)
        return DoubleArray(num) { i -> if (i == num - 1) 1.0 else i * step + 0.0 }
    }

    /** np.interp for one point: clamps outside [xp.first, xp.last], same slope formula as NumPy. */
    private fun interp(x: Double, xp: DoubleArray, fp: DoubleArray): Double {
        val last = xp.lastIndex
        if (x > xp[last]) return fp[last]
        if (x < xp[0]) return fp[0]
        if (x == xp[last]) return fp[last]
        // Largest j with xp[j] <= x (xp is strictly increasing after de-duplication).
        var low = 0
        var high = last
        while (high - low > 1) {
            val mid = (low + high) ushr 1
            if (xp[mid] <= x) low = mid else high = mid
        }
        val slope = (fp[low + 1] - fp[low]) / (xp[low + 1] - xp[low])
        return slope * (x - xp[low]) + fp[low]
    }
}
