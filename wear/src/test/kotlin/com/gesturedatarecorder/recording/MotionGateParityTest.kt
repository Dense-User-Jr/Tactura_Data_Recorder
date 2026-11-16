package com.gesturedatarecorder.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Guards the contract between the watch and the laptop for Listen mode: MotionGate.kt must cut
 * the same bursts out of a stream as `MotionGate` in ML/blueprint_reference.py.
 *
 * Reference values come from `python ML/dump_reference_gate.py`, which plays real recordings
 * one after another as one long stream.
 */
class MotionGateParityTest {
    private val repoRoot = listOf("..", ".")
        .map(::File)
        .first { File(it, "recordings/GestureDataRecorder").isDirectory }

    private val lines: List<List<String>> by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("reference_gate.csv")
        assertNotNull("reference_gate.csv missing; run python ML/dump_reference_gate.py", stream)
        stream!!.bufferedReader().readLines().filter { it.isNotBlank() }.map { it.split(',') }
    }

    /** The gyro events of a recorder CSV, in row (arrival) order. */
    private fun gyroEvents(file: String): List<SensorEventRecord> {
        val rows = File(repoRoot, file).readText().replace("\r\n", "\n").lines().filter { it.isNotBlank() }
        val column = rows.first().split(',').withIndex().associate { (index, name) -> name to index }
        return rows.drop(1).map { it.split(',') }
            .filter { it[column.getValue("source_sensor")] == SensorKind.GYROSCOPE.csvName }
            .map { cells ->
                SensorEventRecord(
                    kind = SensorKind.GYROSCOPE,
                    timestampNs = cells[column.getValue("sensor_timestamp_ns")].toLong(),
                    x = cells[column.getValue("gyro_x")].toFloat(),
                    y = cells[column.getValue("gyro_y")].toFloat(),
                    z = cells[column.getValue("gyro_z")].toFloat()
                )
            }
    }

    @Test
    fun burstsMatchPythonReference() {
        val recipe = lines.first { it[0] == "S" }
        val gap = recipe[1].toLong()
        val gate = MotionGate()
        val bursts = ArrayList<MotionGate.Burst>()
        var offset = 0L
        for (file in recipe[2].split(';')) {
            val events = gyroEvents(file)
            val shift = offset - events.first().timestampNs
            for (event in events) bursts.addAll(gate.push(event.copy(timestampNs = event.timestampNs + shift)))
            offset = events.last().timestampNs + shift + gap
        }

        val expected = lines.filter { it[0] == "B" }
        assertTrue("no reference bursts", expected.isNotEmpty())
        assertEquals("number of bursts", expected.size, bursts.size)
        for ((index, cells) in expected.withIndex()) {
            val burst = bursts[index]
            assertEquals("burst $index: first loud reading", cells[1].toLong(), burst.start)
            assertEquals("burst $index: last loud reading", cells[2].toLong(), burst.last)
            val gyro = burst.gyro
            if (cells[3] == "-1") {
                assertNull("burst $index: Python found it too long", gyro)
                continue
            }
            assertNotNull("burst $index: Python kept it", gyro)
            assertEquals("burst $index: readings", cells[3].toInt(), gyro!![0].size)
            for (axis in 0..2) {
                assertEquals("burst $index: sum of axis $axis", cells[4 + axis].toDouble(), gyro[axis].sum(), TOLERANCE)
            }
            assertEquals("burst $index: strong strokes", cells[7].toInt(), MotionClip.clipsOf(gyro).size)
        }
    }

    /** Feeds [readings] values of [x] on the 50 Hz grid, continuing from [from], and returns the next index. */
    private fun feed(gate: MotionGate, from: Long, readings: Int, x: Double, into: MutableList<MotionGate.Burst>): Long {
        for (i in 0 until readings) into.addAll(gate.push((from + i) * MotionClip.STEP_NS, x, 0.0, 0.0))
        return from + readings
    }

    @Test
    fun aShortBurstBetweenQuietIsKeptWithItsPadding() {
        val gate = MotionGate()
        val found = ArrayList<MotionGate.Burst>()
        var at = feed(gate, 0, 50, 0.0, found)
        at = feed(gate, at, 20, 3.0, found)
        feed(gate, at, 40, 0.0, found)

        assertEquals(1, found.size)
        val burst = found[0]
        assertTrue("a short burst carries its readings", !burst.tooLong)
        // The level is smoothed over 7 readings, so the loud stretch reaches a little past the 20 loud readings.
        assertTrue("starts just before reading 50", burst.start in 47L..50L)
        assertTrue("ends just after reading 69", burst.last in 69L..72L)
        val expected = (burst.last - burst.start + 1).toInt() + 2 * MotionGate.PAD
        assertEquals("padding on both sides", expected, burst.gyro!![0].size)
    }

    @Test
    fun movementThatGoesOnTooLongCarriesNoReadings() {
        val gate = MotionGate()
        val found = ArrayList<MotionGate.Burst>()
        var at = feed(gate, 0, 30, 0.0, found)
        at = feed(gate, at, MotionGate.MAX_LENGTH + 30, 3.0, found)
        feed(gate, at, 40, 0.0, found)

        assertEquals(1, found.size)
        assertTrue("too long to be a gesture", found[0].tooLong)
    }

    @Test
    fun twoBurstsNeedAPauseLongerThanTheQuietTime() {
        // A pause well over QUIET: two bursts.
        var gate = MotionGate()
        var found = ArrayList<MotionGate.Burst>()
        var at = feed(gate, 0, 30, 0.0, found)
        at = feed(gate, at, 20, 3.0, found)
        at = feed(gate, at, MotionGate.QUIET + 10, 0.0, found)
        at = feed(gate, at, 20, 3.0, found)
        feed(gate, at, 40, 0.0, found)
        assertEquals("a clear pause gives two bursts", 2, found.size)

        // A pause shorter than QUIET: heard as one burst.
        gate = MotionGate()
        found = ArrayList()
        at = feed(gate, 0, 30, 0.0, found)
        at = feed(gate, at, 20, 3.0, found)
        at = feed(gate, at, MotionGate.QUIET - 6, 0.0, found)
        at = feed(gate, at, 20, 3.0, found)
        feed(gate, at, 40, 0.0, found)
        assertEquals("a short pause merges them", 1, found.size)
    }

    private companion object {
        const val TOLERANCE = 1e-9
    }
}
