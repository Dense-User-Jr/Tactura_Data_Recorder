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
 * Reference values come from `python ML/dump_reference_clips.py`, which also writes the strong
 * strokes of each window (reference_humps.csv).
 */
class MotionClipParityTest {
    private val repoRoot = listOf("..", ".")
        .map(::File)
        .first { File(it, "data/dhruv/recordings").isDirectory }

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
    fun strongStrokesMatchPythonReference() {
        val stream = javaClass.classLoader!!.getResourceAsStream("reference_humps.csv")
        assertNotNull("reference_humps.csv missing; run python ML/dump_reference_clips.py", stream)
        val expected = stream!!.bufferedReader().readLines().filter { it.isNotBlank() }.map { line ->
            val cells = line.split(',')
            cells[0] to if (cells.size < 2 || cells[1].isEmpty()) emptyList() else cells[1].split(';').map { it.toInt() }
        }
        assertTrue("no reference strokes", expected.isNotEmpty())
        assertTrue("reference has no window with two strong strokes", expected.any { it.second.size > 1 })
        for ((file, humps) in expected) {
            val found = MotionClip.extract(parse(file))
            assertEquals("$file: strong strokes", humps, found.humps.toList())
            assertEquals("$file: one clip per strong stroke", humps.size, found.clips.size)
            if (humps.isNotEmpty()) {
                assertEquals("$file: the loudest stroke comes first", found.peakIndex, found.humps[0])
                assertTrue("$file: the first clip is the main clip", found.clips[0] === found.clip)
            }
        }
    }

    @Test
    fun twoEqualStrokesGiveTwoClips() {
        // A shake: 200 ms turning one way, a pause, then 200 ms turning back just as hard.
        val events = (0 until 150).map { k ->
            val x = when (k) {
                in 40..49 -> -10f
                in 65..74 -> 10f
                else -> 0f
            }
            SensorEventRecord(SensorKind.GYROSCOPE, 1_000_000_000L + k * MotionClip.STEP_NS, x, 0f, 0f)
        }
        val found = MotionClip.extract(events)
        assertEquals(2, found.humps.size)
        assertTrue("first stroke at ${found.humps[0]}", found.humps[0] in 40..49)
        assertTrue("second stroke at ${found.humps[1]}", found.humps[1] in 65..74)
        assertEquals(2, found.clips.size)
    }

    @Test
    fun oneStrokeGivesOneClip() {
        val events = (0 until 150).map { k ->
            val x = if (k in 60..69) 8f else 0f
            SensorEventRecord(SensorKind.GYROSCOPE, 1_000_000_000L + k * MotionClip.STEP_NS, x, 0f, 0f)
        }
        val found = MotionClip.extract(events)
        assertEquals(1, found.humps.size)
        assertEquals(1, found.clips.size)
    }

    @Test
    fun stillWristGivesNoClip() {
        // 3 seconds of a gyroscope reading almost nothing, 50 times a second.
        val events = (0 until 150).map { k ->
            SensorEventRecord(SensorKind.GYROSCOPE, 1_000_000_000L + k * MotionClip.STEP_NS, 0.01f, -0.02f, 0.0f)
        }
        val found = MotionClip.extract(events)
        assertNull(found.clip)
        assertTrue(found.clips.isEmpty())
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
