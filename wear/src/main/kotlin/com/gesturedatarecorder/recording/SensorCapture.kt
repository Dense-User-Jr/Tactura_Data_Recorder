package com.gesturedatarecorder.recording

enum class SensorKind(val csvName: String) {
    ACCELEROMETER("accelerometer"),
    GYROSCOPE("gyroscope")
}

/** One raw sensor event, in arrival order. */
data class SensorEventRecord(
    val kind: SensorKind,
    val timestampNs: Long,
    val x: Float,
    val y: Float,
    val z: Float
)

/**
 * Thread-safe event store for one capture window. Events are appended on the sensor thread
 * and read once on the session coroutine after the window closes.
 */
class SensorCapture {
    private val events = ArrayList<SensorEventRecord>(512)

    @Synchronized
    fun add(event: SensorEventRecord) {
        events += event
    }

    @Synchronized
    fun size(): Int = events.size

    @Synchronized
    fun snapshot(): List<SensorEventRecord> = ArrayList(events)
}

/** Effective sampling rate of one sensor over a capture, in Hz (0 if under two samples). */
fun List<SensorEventRecord>.rateHz(kind: SensorKind): Float {
    val times = asSequence().filter { it.kind == kind }.map { it.timestampNs }.toList()
    if (times.size < 2) return 0f
    val spanNs = times.max() - times.min()
    return if (spanNs <= 0) 0f else ((times.size - 1) * 1e9 / spanNs).toFloat()
}

/**
 * The recorder's CSV format. Do not change it: the training script and every existing
 * recording depend on it (see README "Interpret the CSV").
 */
object CaptureCsv {
    const val HEADER =
        "gesture_label,sample_index,elapsed_ms,sensor_timestamp_ns,source_sensor," +
            "accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z\n"

    /**
     * One row per event in arrival order. The other sensor's columns carry its most recent
     * values (0.0 before its first event); `elapsed_ms` is relative to the first event.
     */
    fun build(label: String, events: List<SensorEventRecord>): String {
        val out = StringBuilder(HEADER.length + events.size * 110).append(HEADER)
        val startNs = events.firstOrNull()?.timestampNs ?: 0L
        val accel = floatArrayOf(0f, 0f, 0f)
        val gyro = floatArrayOf(0f, 0f, 0f)
        events.forEachIndexed { index, event ->
            val target = if (event.kind == SensorKind.ACCELEROMETER) accel else gyro
            target[0] = event.x
            target[1] = event.y
            target[2] = event.z
            out.append(label).append(',')
                .append(index).append(',')
                .append((event.timestampNs - startNs) / 1_000_000L).append(',')
                .append(event.timestampNs).append(',')
                .append(event.kind.csvName)
                .append(',').append(accel[0]).append(',').append(accel[1]).append(',').append(accel[2])
                .append(',').append(gyro[0]).append(',').append(gyro[1]).append(',').append(gyro[2])
                .append('\n')
        }
        return out.toString()
    }
}
