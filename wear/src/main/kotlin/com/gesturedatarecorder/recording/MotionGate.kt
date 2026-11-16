package com.gesturedatarecorder.recording

import kotlin.math.sqrt

/**
 * Finds gestures in a gyro stream that never stops, with no button. The Kotlin twin of
 * `MotionGate` in ML/blueprint_reference.py, kept identical by MotionGateParityTest.
 *
 * Feed it every gyro event with [push]. It puts the events on the even 50 Hz grid as they
 * arrive, tracks the motion level, and returns a [Burst] each time the wrist goes quiet, loud,
 * quiet:
 *
 * - a burst starts at the first reading whose level reaches [MotionClip.THRESHOLD]
 * - it ends once [QUIET] readings in a row are below it
 * - a burst longer than [MAX_LENGTH] is ordinary movement and carries no readings
 *
 * So two gestures need a pause of a little over [QUIET] readings between them, or they are
 * heard as one long burst.
 *
 * The motion level of a reading needs the 3 readings after it, so a burst is reported
 * QUIET + 3 readings (300 ms) after its last loud reading. Not thread safe: call [push] from
 * one thread.
 */
class MotionGate {
    companion object {
        /** A burst is over after this many quiet readings in a row (240 ms). */
        const val QUIET = 12

        /** Readings kept on each side of a burst (160 ms). */
        const val PAD = 8

        /** A burst longer than this (1.8 s) is ordinary movement. */
        const val MAX_LENGTH = 90

        /** Grid readings remembered. Far more than MAX_LENGTH + QUIET + 2 * PAD. */
        private const val CAPACITY = 256
    }

    /**
     * One burst of movement. [start] and [last] are its first and last loud reading, counted
     * from the first event. [gyro] is the burst with [PAD] readings on each side, one row per
     * axis, ready for [MotionClip.clipsOf]. It is null when the burst was too long.
     */
    class Burst(val start: Long, val last: Long, val gyro: Array<DoubleArray>?) {
        val tooLong: Boolean get() = gyro == null
    }

    private var hasPrevious = false
    private var previousTime = 0L
    private val previous = DoubleArray(3)
    private var nextGrid = 0L

    private val ring = Array(3) { DoubleArray(CAPACITY) }
    private val energy = DoubleArray(CAPACITY)
    private var count = 0L
    private var start = -1L
    private var last = -1L

    /** True from a burst's first loud reading until the burst is reported: the wrist is, or just was, moving fast. */
    val moving: Boolean get() = start >= 0

    /** One gyro event as the watch delivers it. The values go through the same text form as the CSVs. */
    fun push(event: SensorEventRecord): List<Burst> = push(
        event.timestampNs,
        MotionClip.csvValue(event.x),
        MotionClip.csvValue(event.y),
        MotionClip.csvValue(event.z)
    )

    /** One gyro event. Returns the bursts that just ended, which is almost always none. */
    fun push(timestampNs: Long, x: Double, y: Double, z: Double): List<Burst> {
        if (!hasPrevious) {
            hasPrevious = true
            remember(timestampNs, x, y, z)
            nextGrid = timestampNs
            return emptyList()
        }
        if (timestampNs <= previousTime) return emptyList() // same instant twice: keep the first
        var found: MutableList<Burst>? = null
        while (nextGrid <= timestampNs) {
            val fraction = (nextGrid - previousTime).toDouble() / (timestampNs - previousTime).toDouble()
            val burst = reading(
                previous[0] + fraction * (x - previous[0]),
                previous[1] + fraction * (y - previous[1]),
                previous[2] + fraction * (z - previous[2])
            )
            if (burst != null) {
                val list = found ?: ArrayList<Burst>().also { found = it }
                list.add(burst)
            }
            nextGrid += MotionClip.STEP_NS
        }
        remember(timestampNs, x, y, z)
        return found ?: emptyList()
    }

    private fun remember(timestampNs: Long, x: Double, y: Double, z: Double) {
        previousTime = timestampNs
        previous[0] = x
        previous[1] = y
        previous[2] = z
    }

    /** One more reading on the grid. Works out the level of the reading 3 back and steps the gate. */
    private fun reading(x: Double, y: Double, z: Double): Burst? {
        val slot = (count % CAPACITY).toInt()
        ring[0][slot] = x
        ring[1][slot] = y
        ring[2][slot] = z
        energy[slot] = x * x + y * y + z * z
        count++
        val reach = MotionClip.SMOOTH / 2
        val centre = count - 1 - reach // the newest reading whose level is known
        if (centre < 0) return null
        var total = 0.0
        for (k in centre - reach..centre + reach) {
            if (k >= 0) total += energy[(k % CAPACITY).toInt()]
        }
        return step(centre, sqrt(total / MotionClip.SMOOTH))
    }

    private fun step(t: Long, level: Double): Burst? {
        val loud = level >= MotionClip.THRESHOLD
        if (start < 0) {
            if (loud) {
                start = t
                last = t
            }
            return null
        }
        if (loud) {
            last = t
            return null
        }
        if (t - last < QUIET) return null
        val from = start
        val to = last
        start = -1
        last = -1
        if (to - from + 1 > MAX_LENGTH) return Burst(from, to, null)
        val first = maxOf(0L, from - PAD)
        val length = (to + PAD - first + 1).toInt()
        val gyro = Array(3) { axis -> DoubleArray(length) { i -> ring[axis][((first + i) % CAPACITY).toInt()] } }
        return Burst(from, to, gyro)
    }
}
