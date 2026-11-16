package com.gesturedatarecorder.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The fist that chooses a word: a hard jolt on the accelerometer while the wrist hardly turns. */
class FistDetectorTest {
    private val step = 20_000_000L // 50 readings a second

    /**
     * Plays [readings] steps starting at step [from]. The accelerometer rests at gravity, with one
     * jump of [jolt] m/s2 at step [joltAt]. [gyro] gives the gyro size at each step. Returns the
     * judgements in order.
     */
    private fun play(
        detector: FistDetector,
        from: Int,
        readings: Int,
        joltAt: Int = -1,
        jolt: Double = 0.0,
        armed: Boolean = true,
        gyro: (Int) -> Double = { 0.1 }
    ): List<FistDetector.Outcome> {
        val out = ArrayList<FistDetector.Outcome>()
        for (i in from until from + readings) {
            val t = i * step
            detector.accel(t, 0.0, 0.0, if (i == joltAt) 9.8 + jolt else 9.8, armed)
            detector.gyro(t + 1, gyro(i), 0.0, 0.0)?.let { out.add(it) }
        }
        return out
    }

    @Test
    fun aHardJoltFromACalmWristIsAFist() {
        val detector = FistDetector()
        val out = play(detector, 0, 120, joltAt = 40, jolt = 12.0) { i -> if (i in 40..50) 1.5 else 0.1 }
        assertEquals(listOf(FistDetector.Outcome.FIST), out)
        assertFalse(detector.pending)
    }

    @Test
    fun aPinchIsTooSmall() {
        val detector = FistDetector()
        val out = play(detector, 0, 120, joltAt = 40, jolt = 4.5) { i -> if (i in 40..45) 1.0 else 0.1 }
        assertTrue("a jolt under the bar is not even judged", out.isEmpty())
    }

    @Test
    fun aJoltThatStartsAGestureIsTurnedDownAtOnce() {
        val detector = FistDetector()
        // The wrist turns at 6 rad/s from five readings after the jolt.
        val out = play(detector, 0, 50, joltAt = 40, jolt = 12.0) { i -> if (i >= 45) 6.0 else 0.1 }
        assertEquals("turned down within the first quarter second", listOf(FistDetector.Outcome.NOT_A_FIST), out)
    }

    @Test
    fun aWristThatWasAlreadyMovingDoesNotCount() {
        val detector = FistDetector()
        val out = play(detector, 0, 120, joltAt = 40, jolt = 12.0) { i -> if (i in 30..38) 2.0 else 0.1 }
        assertEquals(listOf(FistDetector.Outcome.NOT_A_FIST), out)
    }

    @Test
    fun aWristThatIsNotCalmAfterwardsDoesNotCount() {
        val detector = FistDetector()
        val out = play(detector, 0, 120, joltAt = 40, jolt = 12.0) { i -> if (i in 66..72) 1.0 else 0.1 }
        assertEquals(listOf(FistDetector.Outcome.NOT_A_FIST), out)
    }

    @Test
    fun nothingIsJudgedWhenNotArmed() {
        val detector = FistDetector()
        assertTrue(play(detector, 0, 120, joltAt = 40, jolt = 12.0, armed = false).isEmpty())
        assertFalse(detector.pending)
    }

    @Test
    fun openingTheHandRightAfterIsNotASecondFist() {
        val detector = FistDetector()
        val first = play(detector, 0, 80, joltAt = 40, jolt = 12.0)
        assertEquals(listOf(FistDetector.Outcome.FIST), first)
        // A second jolt half a second after the judgement: still resting.
        val second = play(detector, 80, 120, joltAt = 100, jolt = 12.0)
        assertTrue("the hand opening again is ignored", second.isEmpty())
        // Two seconds later a new fist counts again.
        val third = play(detector, 200, 120, joltAt = 240, jolt = 12.0)
        assertEquals(listOf(FistDetector.Outcome.FIST), third)
    }

    @Test
    fun theJudgementComesAboutTwoThirdsOfASecondAfterTheJolt() {
        val detector = FistDetector()
        var judgedAt = -1
        for (i in 0 until 120) {
            detector.accel(i * step, 0.0, 0.0, if (i == 40) 21.8 else 9.8, true)
            if (detector.gyro(i * step + 1, 0.1, 0.0, 0.0) != null && judgedAt < 0) judgedAt = i
        }
        assertEquals("0.65 s is 32.5 readings, so the 33rd after the jolt", 73, judgedAt)
        assertNull(detector.gyro(121 * step, 0.1, 0.0, 0.0))
    }
}
