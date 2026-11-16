package com.gesturedatarecorder.recording

import kotlin.math.atan2

/**
 * A cursor moved by tilting the wrist slowly, for picking one of a few words in Listen mode.
 *
 * The accelerometer feels gravity, so it tells which way is down even when the wrist is still.
 * Smoothing its readings gives the direction of gravity as the watch sees it, and from that
 * the tilt of the wrist as an angle. The cursor does not care how the wrist is held, only how
 * far it has tilted since [rezero]: the first option is picked at the start, and each further
 * tilt of the axis's step moves one option on.
 *
 * A gesture is a fast burst and this is a slow held tilt, which is what keeps the two apart.
 */
class TiltCursor {
    /**
     * Which tilt moves the cursor, and how far it has to go, in degrees. [firstDeg] moves the
     * cursor off the first option and [stepDeg] is each option after that. The cursor only
     * moves back once the tilt is [backDeg] under the line it crossed, so it does not flicker.
     */
    enum class Axis(val label: String, val firstDeg: Double, val stepDeg: Double, val backDeg: Double) {
        OFF("Off", 0.0, 0.0, 0.0),

        /** Tip the hand down or up, like nodding with the wrist. Down moves down the list. A wrist only nods a little, so the steps are small. */
        NOD("Nod", 10.0, 12.0, 3.0),

        /**
         * Turn the forearm like a dial. Turning the way a Twist Right goes moves down the list.
         * A forearm turns far and easily, so the steps are about twice as big: with the nod's
         * steps a minor turn ran from the first word to the last.
         */
        ROLL("Roll", 20.0, 22.0, 5.0)
    }

    companion object {
        /** Share of each new reading mixed into the gravity estimate: about 120 ms of smoothing at 50 Hz. */
        const val SMOOTH = 0.15
    }

    private val gravity = DoubleArray(3)
    private var seen = false
    private var reference = Double.NaN

    /** The option the cursor is on, counted from 0. */
    var index = 0
        private set

    /** One accelerometer reading, in m/s2. */
    fun push(x: Double, y: Double, z: Double) {
        if (!seen) {
            gravity[0] = x
            gravity[1] = y
            gravity[2] = z
            seen = true
            return
        }
        gravity[0] += SMOOTH * (x - gravity[0])
        gravity[1] += SMOOTH * (y - gravity[1])
        gravity[2] += SMOOTH * (z - gravity[2])
    }

    /**
     * The wrist's tilt in degrees. Both are 0 with the watch face up. Roll grows the way a
     * Twist Right turns. Nod grows as the hand tips down.
     */
    fun angle(axis: Axis): Double = when (axis) {
        Axis.ROLL -> Math.toDegrees(atan2(gravity[1], gravity[2]))
        Axis.NOD -> Math.toDegrees(atan2(-gravity[0], gravity[2]))
        Axis.OFF -> 0.0
    }

    /** Puts the cursor back on the first option. The tilt at the next [update] becomes the new starting point. */
    fun rezero() {
        reference = Double.NaN
        index = 0
    }

    /**
     * Moves the cursor for the current tilt among [options] choices and returns where it is:
     * -1 when the cursor is off or there is nothing to choose.
     */
    fun update(axis: Axis, options: Int): Int {
        if (axis == Axis.OFF || options <= 0 || !seen) {
            rezero()
            return -1
        }
        val now = angle(axis)
        if (reference.isNaN()) reference = now
        var tilt = now - reference
        if (tilt > 180.0) tilt -= 360.0
        if (tilt < -180.0) tilt += 360.0
        while (index < options - 1 && tilt >= axis.firstDeg + index * axis.stepDeg) index++
        while (index > 0 && tilt < axis.firstDeg + (index - 1) * axis.stepDeg - axis.backDeg) index--
        if (index > options - 1) index = options - 1
        return index
    }
}
