package com.gesturedatarecorder.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Guards the contract between the watch and the training pipeline, using real recordings
 * from recordings/GestureDataRecorder:
 *  1. GestureFeatures.kt produces exactly the features of Python's recording_features()
 *     (reference values from ML/dump_reference_features.py);
 *  2. CaptureCsv rebuilds a recorded CSV byte for byte, so the on-watch CSV format is unchanged.
 */
class GestureFeaturesParityTest {
    private val recordingsDir = listOf("../recordings/GestureDataRecorder", "recordings/GestureDataRecorder")
        .map(::File)
        .first { it.isDirectory }

    private val reference: List<Pair<String, FloatArray>> by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("reference_features.csv")
        assertNotNull("reference_features.csv missing; run python ML/dump_reference_features.py", stream)
        stream!!.bufferedReader().readLines().filter { it.isNotBlank() }.map { line ->
            val cells = line.split(',')
            cells[0] to FloatArray(cells.size - 1) { cells[it + 1].toFloat() }
        }
    }

    private fun readText(name: String) = File(recordingsDir, name).readText().replace("\r\n", "\n")

    /** Parses a recorder CSV back into events, in row (arrival) order. */
    private fun parse(text: String): Pair<String, List<SensorEventRecord>> {
        val lines = text.lines().filter { it.isNotBlank() }
        val header = lines.first().split(',')
        val column = header.withIndex().associate { (index, name) -> name to index }
        var label = ""
        val events = lines.drop(1).map { line ->
            val cells = line.split(',')
            label = cells[column.getValue("gesture_label")]
            val kind = SensorKind.entries.first { it.csvName == cells[column.getValue("source_sensor")] }
            val prefix = if (kind == SensorKind.ACCELEROMETER) "accel" else "gyro"
            SensorEventRecord(
                kind = kind,
                timestampNs = cells[column.getValue("sensor_timestamp_ns")].toLong(),
                x = cells[column.getValue("${prefix}_x")].toFloat(),
                y = cells[column.getValue("${prefix}_y")].toFloat(),
                z = cells[column.getValue("${prefix}_z")].toFloat()
            )
        }
        return label to events
    }

    @Test
    fun featuresMatchPythonReferenceExactly() {
        assertTrue("no reference vectors", reference.isNotEmpty())
        for ((name, expected) in reference) {
            val (_, events) = parse(readText(name))
            val actual = GestureFeatures.extract(events)
            assertNotNull("$name: no features", actual)
            assertEquals("$name: feature count", GestureFeatures.FEATURE_COUNT, actual!!.size)
            for (index in expected.indices) {
                assertEquals(
                    "$name: feature $index (${channelName(index)}) differs from Python",
                    expected[index].toRawBits(),
                    actual[index].toRawBits()
                )
            }
        }
    }

    @Test
    fun csvBuilderReproducesRecordedFiles() {
        for ((name, _) in reference) {
            val original = readText(name)
            val (label, events) = parse(original)
            assertEquals("$name: CSV output changed", original, CaptureCsv.build(label, events))
        }
    }

    @Test
    fun missingSensorYieldsNoFeatures() {
        val onlyAccel = listOf(SensorEventRecord(SensorKind.ACCELEROMETER, 1_000_000L, 0f, 0f, 9.8f))
        assertEquals(null, GestureFeatures.extract(onlyAccel))
    }

    private fun channelName(index: Int): String {
        val channels = listOf("accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z")
        return "%s_t%02d".format(channels[index / GestureFeatures.TIME_BINS], index % GestureFeatures.TIME_BINS)
    }
}
