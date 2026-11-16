package com.gesturedatarecorder.recording

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

/** The tilt cursor of Listen mode: a slow tilt of the wrist moves through the offered words. */
class TiltCursorTest {
    private val g = 9.81

    /** Holds the wrist at [degrees] of nod (hand tipped down) long enough for the smoothing to settle. */
    private fun nod(cursor: TiltCursor, degrees: Double) {
        val angle = Math.toRadians(degrees)
        repeat(80) { cursor.push(-g * sin(angle), 0.0, g * cos(angle)) }
    }

    /** Holds the wrist at [degrees] of roll (turned the way a Twist Right goes). */
    private fun roll(cursor: TiltCursor, degrees: Double) {
        val angle = Math.toRadians(degrees)
        repeat(80) { cursor.push(0.0, g * sin(angle), g * cos(angle)) }
    }

    @Test
    fun theAnglesAreZeroFaceUpAndGrowTheRightWay() {
        val cursor = TiltCursor()
        nod(cursor, 0.0)
        assertEquals(0.0, cursor.angle(TiltCursor.Axis.NOD), 0.01)
        assertEquals(0.0, cursor.angle(TiltCursor.Axis.ROLL), 0.01)
        nod(cursor, 20.0)
        assertEquals(20.0, cursor.angle(TiltCursor.Axis.NOD), 0.1)
        roll(cursor, 35.0)
        assertEquals(35.0, cursor.angle(TiltCursor.Axis.ROLL), 0.1)
    }

    @Test
    fun tippingTheHandDownMovesDownTheList() {
        val cursor = TiltCursor()
        nod(cursor, 3.0) // however the wrist happens to rest
        assertEquals("starts on the first word", 0, cursor.update(TiltCursor.Axis.NOD, 3))
        nod(cursor, 3.0 + 6.0)
        assertEquals("a small tilt changes nothing", 0, cursor.update(TiltCursor.Axis.NOD, 3))
        nod(cursor, 3.0 + 12.0)
        assertEquals(1, cursor.update(TiltCursor.Axis.NOD, 3))
        nod(cursor, 3.0 + 24.0)
        assertEquals(2, cursor.update(TiltCursor.Axis.NOD, 3))
        nod(cursor, 3.0 + 60.0)
        assertEquals("it stops at the last word", 2, cursor.update(TiltCursor.Axis.NOD, 3))
    }

    @Test
    fun theCursorDoesNotFlickerAtALine() {
        val cursor = TiltCursor()
        nod(cursor, 0.0)
        cursor.update(TiltCursor.Axis.NOD, 3)
        nod(cursor, 11.0)
        assertEquals(1, cursor.update(TiltCursor.Axis.NOD, 3))
        nod(cursor, 8.0) // back under the 10 degree line, but not by 3 degrees
        assertEquals("still on the second word", 1, cursor.update(TiltCursor.Axis.NOD, 3))
        nod(cursor, 5.0)
        assertEquals("well under the line: back to the first", 0, cursor.update(TiltCursor.Axis.NOD, 3))
        nod(cursor, -30.0)
        assertEquals("tilting the other way stays on the first", 0, cursor.update(TiltCursor.Axis.NOD, 3))
    }

    @Test
    fun rezeroStartsAgainFromWhereverTheWristIs() {
        val cursor = TiltCursor()
        nod(cursor, 0.0)
        cursor.update(TiltCursor.Axis.NOD, 3)
        nod(cursor, 25.0)
        assertEquals(2, cursor.update(TiltCursor.Axis.NOD, 3))
        cursor.rezero()
        assertEquals("the tilted pose is the new start", 0, cursor.update(TiltCursor.Axis.NOD, 3))
        nod(cursor, 25.0 + 12.0)
        assertEquals(1, cursor.update(TiltCursor.Axis.NOD, 3))
    }

    @Test
    fun rollingTheForearmTakesABiggerTurn() {
        val cursor = TiltCursor()
        roll(cursor, -2.0)
        assertEquals(0, cursor.update(TiltCursor.Axis.ROLL, 3))
        roll(cursor, -2.0 + 15.0)
        assertEquals("a minor turn changes nothing", 0, cursor.update(TiltCursor.Axis.ROLL, 3))
        roll(cursor, -2.0 + 25.0)
        assertEquals(1, cursor.update(TiltCursor.Axis.ROLL, 3))
        roll(cursor, -2.0 + 38.0)
        assertEquals("not yet at the third word", 1, cursor.update(TiltCursor.Axis.ROLL, 3))
        roll(cursor, -2.0 + 45.0)
        assertEquals(2, cursor.update(TiltCursor.Axis.ROLL, 3))
        roll(cursor, -2.0 + 39.0)
        assertEquals("it holds the third word a little under the line", 2, cursor.update(TiltCursor.Axis.ROLL, 3))
        roll(cursor, -2.0 + 30.0)
        assertEquals(1, cursor.update(TiltCursor.Axis.ROLL, 3))

        val two = TiltCursor()
        roll(two, 0.0)
        two.update(TiltCursor.Axis.ROLL, 2)
        roll(two, 80.0)
        assertEquals("two words: it stops at the second", 1, two.update(TiltCursor.Axis.ROLL, 2))
    }

    @Test
    fun offOrNothingToChooseGivesNoCursor() {
        val cursor = TiltCursor()
        nod(cursor, 20.0)
        assertEquals(-1, cursor.update(TiltCursor.Axis.OFF, 3))
        assertEquals(-1, cursor.update(TiltCursor.Axis.NOD, 0))
        assertEquals("one word: the cursor sits on it", 0, cursor.update(TiltCursor.Axis.NOD, 1))
    }
}
