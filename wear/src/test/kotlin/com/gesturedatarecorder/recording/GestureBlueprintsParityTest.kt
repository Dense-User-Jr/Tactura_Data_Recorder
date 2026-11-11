package com.gesturedatarecorder.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Guards the contract between the watch and the laptop for steps 4 to 6 of the v2 recipe:
 * GestureBlueprints.kt must build the same blueprints, reach the same decisions and make the same
 * updates as ML/blueprint_reference.py, starting from the same real recordings.
 *
 * Reference values come from `python ML/dump_reference_blueprints.py`.
 */
class GestureBlueprintsParityTest {
    private val repoRoot = listOf("..", ".")
        .map(::File)
        .first { File(it, "recordings/GestureDataRecorder").isDirectory }

    private val lines: List<List<String>> by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("reference_blueprints.csv")
        assertNotNull("reference_blueprints.csv missing; run python ML/dump_reference_blueprints.py", stream)
        stream!!.bufferedReader().readLines().filter { it.isNotBlank() }.map { it.split(',') }
    }

    /** Blueprints rebuilt by the Kotlin code from the files the reference lists. */
    private val blueprints: Map<String, GestureBlueprints.Blueprint> by lazy {
        lines.filter { it[0] == "F" }.associate { cells ->
            cells[1] to GestureBlueprints.build(cells[2].split(';').map { file -> clipOf(file)!! })
        }
    }

    /** Parses a recorder CSV back into events, in row (arrival) order. */
    private fun parse(file: String): List<SensorEventRecord> {
        val rows = File(repoRoot, file).readText().replace("\r\n", "\n").lines().filter { it.isNotBlank() }
        val header = rows.first().split(',')
        val column = header.withIndex().associate { (index, name) -> name to index }
        return rows.drop(1).map { row ->
            val cells = row.split(',')
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

    private fun clipOf(file: String): Array<DoubleArray>? = MotionClip.extract(parse(file)).clip

    private fun assertSameBlueprint(
        what: String,
        expectedCount: Int,
        expectedSize: Double,
        expectedMean: List<String>,
        actual: GestureBlueprints.Blueprint
    ) {
        assertEquals("$what: rep count", expectedCount, actual.count)
        assertEquals("$what: size", expectedSize, actual.size, TOLERANCE)
        assertEquals("$what: mean length", 3 * MotionClip.CLIP_LEN, expectedMean.size)
        for (axis in 0..2) {
            for (i in 0 until MotionClip.CLIP_LEN) {
                assertEquals(
                    "$what: axis $axis reading $i differs from Python",
                    expectedMean[axis * MotionClip.CLIP_LEN + i].toDouble(),
                    actual.mean[axis][i],
                    TOLERANCE
                )
            }
        }
    }

    @Test
    fun blueprintsMatchPythonReference() {
        val expected = lines.filter { it[0] == "B" }
        assertTrue("no reference blueprints", expected.isNotEmpty())
        for (cells in expected) {
            val actual = blueprints[cells[1]]
            assertNotNull("${cells[1]}: no blueprint built", actual)
            assertSameBlueprint(cells[1], cells[2].toInt(), cells[3].toDouble(), cells.drop(4), actual!!)
        }
    }

    @Test
    fun decisionsMatchPythonReference() {
        val expected = lines.filter { it[0] == "T" }
        assertTrue("no reference decisions", expected.isNotEmpty())
        assertTrue("reference never says NONE", expected.any { it[2] == "NONE" })
        for (cells in expected) {
            val file = cells[1]
            val match = GestureBlueprints.classify(clipOf(file), blueprints)
            assertEquals("$file: decision", cells[2], match.gesture ?: "NONE")
            val distance = cells[3].toDouble()
            if (distance.isInfinite()) {
                assertTrue("$file: Python saw a quiet wrist", match.distance.isInfinite())
            } else {
                assertEquals("$file: distance", distance, match.distance, TOLERANCE)
            }
        }
    }

    @Test
    fun updatesMatchPythonReference() {
        val expected = lines.filter { it[0] == "U" }
        assertTrue("no reference updates", expected.isNotEmpty())
        for (cells in expected) {
            val gesture = cells[1]
            val updated = GestureBlueprints.update(blueprints.getValue(gesture), clipOf(cells[2])!!)
            assertSameBlueprint("$gesture after one more rep", cells[3].toInt(), cells[4].toDouble(), cells.drop(5), updated)
        }
    }

    @Test
    fun quietWristAndEmptyBlueprintsGiveNoGesture() {
        assertNull(GestureBlueprints.classify(null, blueprints).gesture)
        val anyClip = blueprints.values.first().mean
        assertNull(GestureBlueprints.classify(anyClip, emptyMap()).gesture)
    }

    @Test
    fun aBlueprintMatchesItself() {
        for ((gesture, blueprint) in blueprints) {
            val match = GestureBlueprints.classify(blueprint.mean, blueprints)
            assertEquals(gesture, match.gesture)
            assertEquals(0.0, match.distance, TOLERANCE)
        }
    }

    private companion object {
        /** rad/s. Far below anything that matters, loose enough for the last binary digit. */
        const val TOLERANCE = 1e-9
    }
}
