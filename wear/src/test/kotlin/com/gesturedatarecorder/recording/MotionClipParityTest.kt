package com.gesturedatarecorder.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Guards the contract between the watch and the laptop for the v2 recipe: MotionClip.kt must give
 * the same peak and the same clip as steps 0 to 3 of ML/blueprint_reference.py, on real recordings
 * (training CSVs and windows pulled from a watch, including still-arm windows).
 *
 * Reference values come from `python ML/dump_reference_clips.py`.
 */
class MotionClipParityTest {
    private val repoRoot = listOf("..", ".")
        .map(::File)
        .first { File(it, "recordings/GestureDataRecorder").isDirectory }

    private class Reference(val file: String, val peakIndex: Int, val peakLevel: Double, val clip: DoubleArray?)

    private val references: List<Reference> by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("reference_clips.csv")
        assertNotNull("reference_clips.csv missing; run python ML/dump_reference_clips.py", stream)
        stream!!.bufferedReader().readLines().filter { it.isNotBlank() }.map { line ->
            val cells = line.split(',')
            val clip = if (cells.size > 3) DoubleArray(cells.size - 3) { cells[it + 3].toDouble() } else null
            Reference(cells[0], cells[1].toInt(), cells[2].toDouble(), clip)
        }
    }

    /** Parses a recorder CSV back into events, in row (arrival) order. */
    private fun parse(file: String): List<SensorEventRecord> {
        val lines = File(repoRoot, file).readText().replace("\r\n", "\n").lines().filter { it.isNotBlank() }
        val header = lines.first().split(',')
        val column = header.withIndex().associate { (index, name) -> name to index }
        return lines.drop(1).map { line ->
            val cells = line.split(',')
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
    }

    @Test
    fun peakAndClipMatchPythonReference() {
        assertTrue("no reference clips", references.isNotEmpty())
        assertTrue("reference has no quiet windows", references.any { it.clip == null })
        for (reference in references) {
            val found = MotionClip.extract(parse(reference.file))
            assertEquals("${reference.file}: peak index", reference.peakIndex, found.peakIndex)
            assertEquals("${reference.file}: peak level", reference.peakLevel, found.peakLevel, TOLERANCE)
            val expected = reference.clip
            val actual = found.clip
            if (expected == null) {
                assertNull("${reference.file}: Python saw a quiet wrist, Kotlin found a gesture", actual)
                continue
            }
            assertNotNull("${reference.file}: Python found a gesture, Kotlin saw a quiet wrist", actual)
            assertEquals("${reference.file}: clip size", 3 * MotionClip.CLIP_LEN, expected.size)
            for (axis in 0..2) {
                for (i in 0 until MotionClip.CLIP_LEN) {
                    assertEquals(
                        "${reference.file}: axis $axis reading $i differs from Python",
                        expected[axis * MotionClip.CLIP_LEN + i],
                        actual!![axis][i],
                        TOLERANCE
                    )
                }
            }
        }
    }

    @Test
    fun stillWristGivesNoClip() {
        // 3 seconds of a gyroscope reading almost nothing, 50 times a second.
        val events = (0 until 150).map { k ->
            SensorEventRecord(SensorKind.GYROSCOPE, 1_000_000_000L + k * MotionClip.STEP_NS, 0.01f, -0.02f, 0.0f)
        }
        val found = MotionClip.extract(events)
        assertNull(found.clip)
        assertTrue(found.peakLevel < MotionClip.THRESHOLD)
    }

    @Test
    fun tooFewEventsGiveNoClip() {
        val onlyAccelerometer = listOf(SensorEventRecord(SensorKind.ACCELEROMETER, 1_000_000L, 0f, 0f, 9.8f))
        assertNull(MotionClip.extract(onlyAccelerometer).clip)
        assertNull(MotionClip.extract(emptyList()).clip)
    }

    private companion object {
        /** rad/s. Far below anything that matters, loose enough for the last binary digit. */
        const val TOLERANCE = 1e-9
    }
}
