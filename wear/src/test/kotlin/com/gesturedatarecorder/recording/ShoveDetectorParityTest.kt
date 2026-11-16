package com.gesturedatarecorder.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Guards the contract between the watch and the laptop for shoves: ShoveDetector.kt must make
 * the same of a stream as `ShoveDetector` in ML/shove_reference.py.
 *
 * The stream and the reference outcomes come from `python ML/dump_reference_shove.py`, which
 * plays real shove recordings one after another at 50 readings a second.
 */
class ShoveDetectorParityTest {
    private val lines: List<List<String>> by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("reference_shove.csv")
        assertNotNull("reference_shove.csv missing; run python ML/dump_reference_shove.py", stream)
        stream!!.bufferedReader().readLines().filter { it.isNotBlank() }.map { it.split(',') }
    }

    @Test
    fun outcomesMatchPythonReference() {
        val detector = ShoveDetector()
        val found = ArrayList<Pair<Int, ShoveDetector.Outcome>>()
        val events = lines.filter { it[0] == "E" }
        for ((index, cells) in events.withIndex()) {
            val time = cells[2].toLong()
            val x = cells[3].toDouble()
            val y = cells[4].toDouble()
            val z = cells[5].toDouble()
            if (cells[1] == "G") {
                detector.gyro(time, x, y, z)
            } else {
                val outcome = detector.accel(time, x, y, z)
                if (outcome != null) found.add(index to outcome)
            }
        }

        val expected = lines.filter { it[0] == "O" }
        assertTrue("no reference outcomes", expected.isNotEmpty())
        assertTrue("the reference has shoves in it", expected.count { it[2] != "NONE" } >= 4)
        assertEquals("number of judged stretches", expected.size, found.size)
        for ((at, cells) in expected.withIndex()) {
            val (index, outcome) = found[at]
            assertEquals("stretch $at: the event that produced it", cells[1].toInt(), index)
            assertEquals("stretch $at: direction", cells[2], outcome.direction?.name ?: "NONE")
            assertEquals("stretch $at: start", cells[3].toLong(), outcome.startNs)
            assertEquals("stretch $at: end", cells[4].toLong(), outcome.endNs)
            assertEquals("stretch $at: reason", cells[5], outcome.reason)
            assertEquals("stretch $at: speed", cells[6].toDouble(), outcome.speed, TOLERANCE)
            assertEquals("stretch $at: axis", cells[7].toInt(), outcome.axis)
            assertEquals("stretch $at: turned", cells[8].toDouble(), outcome.turned, TOLERANCE)
            assertEquals("stretch $at: gyro peak", cells[9].toDouble(), outcome.gyroPeak, TOLERANCE)
        }
    }

    /**
     * Plays a made-up movement at 50 readings a second: the watch lies face up, and from reading
     * [from] the hand speeds up along one axis and stops again over [length] readings, then comes
     * back the same way. [gyroAt] is the gyro size during the movement. The detector hears the
     * way out and the way back as two stretches, because the hand slows evenly in between.
     */
    private fun play(axis: Int, push: Double, gyroAt: Double = 0.0, from: Int = 40, length: Int = 12, total: Int = 140): List<ShoveDetector.Outcome> {
        val detector = ShoveDetector()
        val out = ArrayList<ShoveDetector.Outcome>()
        for (i in 0 until total) {
            val time = i * 20_000_000L
            val accel = doubleArrayOf(0.0, 0.0, 9.81)
            // Out: speed up, then slow down. Back: the same the other way round.
            val phase = (i - from) / length
            if (i >= from && phase < 4) accel[axis] += if (phase == 0 || phase == 3) push else -push
            detector.gyro(time, if (i >= from && phase < 4) gyroAt else 0.0, 0.0, 0.0)
            detector.accel(time, accel[0], accel[1], accel[2])?.let { out.add(it) }
        }
        return out
    }

    @Test
    fun aPushAlongEachAxisIsNamedByItsDirection() {
        assertEquals(Gesture.SHOVE_UP, play(axis = 2, push = 3.0).first().direction)
        assertEquals(Gesture.SHOVE_DOWN, play(axis = 2, push = -3.0).first().direction)
        assertEquals(Gesture.SHOVE_LEFT, play(axis = 1, push = 3.0).first().direction)
        assertEquals(Gesture.SHOVE_RIGHT, play(axis = 1, push = -3.0).first().direction)
    }

    @Test
    fun theHandComingBackIsNotASecondShove() {
        val outcomes = play(axis = 2, push = 3.0)
        assertEquals("one shove", 1, outcomes.count { it.direction != null })
        assertEquals(Gesture.SHOVE_UP, outcomes.first().direction)
        assertEquals("the way back falls in the rest after a shove", "rest", outcomes.last().reason)
    }

    @Test
    fun aPushAlongTheArmIsNoShove() {
        val outcome = play(axis = 0, push = 3.0).first()
        assertNull(outcome.direction)
        assertEquals("along the arm", outcome.reason)
    }

    @Test
    fun aFaintPushIsNoShove() {
        val outcome = play(axis = 2, push = 1.0).first()
        assertNull(outcome.direction)
        assertEquals("slow", outcome.reason)
    }

    @Test
    fun aFastTurningWristIsTurnedDownAtOnce() {
        val outcomes = play(axis = 2, push = 3.0, gyroAt = 3.0)
        assertEquals(1, outcomes.size)
        assertNull(outcomes[0].direction)
        assertEquals("turning", outcomes[0].reason)
        // Turned down on the first moving reading, long before the movement ends.
        assertTrue(outcomes[0].endNs <= 41 * 20_000_000L)
    }

    @Test
    fun aStillWristGivesNothing() {
        val detector = ShoveDetector()
        for (i in 0 until 200) {
            detector.gyro(i * 20_000_000L, 0.0, 0.0, 0.0)
            assertNull(detector.accel(i * 20_000_000L, 0.0, 0.0, 9.81))
        }
        assertFalse(detector.moving)
    }

    private companion object {
        const val TOLERANCE = 1e-9
    }
}
