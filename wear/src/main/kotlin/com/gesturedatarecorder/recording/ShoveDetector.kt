package com.gesturedatarecorder.recording

import java.util.Locale
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Feels a shove of the hand: the whole hand moving a few inches up, down, left or right and
 * coming back, without the wrist turning. The Kotlin twin of `ShoveDetector` in
 * ML/shove_reference.py, kept identical by ShoveDetectorParityTest.
 *
 * The gyro hardly sees a shove. The accelerometer does, but it feels gravity too, and gravity
 * swings around in its readings whenever the wrist tilts. So:
 *
 * 1. Find a stretch of movement. A reading is active when the accelerometer is more than
 *    [ACTIVE_ACCEL] away from the average of the [MEAN] readings before it, or the gyro is
 *    over [ACTIVE_GYRO]. A stretch starts at the first active reading and ends after [QUIET]
 *    readings in a row that are not.
 * 2. Take gravity out. The gyro says how the watch turned since the stretch began, so every
 *    accelerometer reading is turned back into the frame the watch started in, and the resting
 *    reading from just before is subtracted. What is left is the hand's own acceleration.
 * 3. Add it up into the hand's velocity. The hand goes out and comes back, so the velocity is
 *    corrected to start and end at zero.
 * 4. The velocity at its first peak is the first push: which way, and how fast.
 *
 * It is a shove when the first push is clearly along the watch's y or z, fast enough, and the
 * wrist stayed calm. Worn face up on the left wrist, +z is up and +y is to the wearer's left.
 *
 * The numbers come from 32 recorded shoves, 81 reps of the five gestures, 35 pinches and fists
 * and 20 minutes of listening (docs/gesture-recognition-v2-plan.md). They assume about 50
 * readings a second and the normal gesture pose. Not thread safe: call from one thread.
 */
class ShoveDetector {
    companion object {
        /** The four shoves, in the order of the [Gesture] enum. */
        val GESTURES: List<Gesture> = listOf(Gesture.SHOVE_UP, Gesture.SHOVE_DOWN, Gesture.SHOVE_LEFT, Gesture.SHOVE_RIGHT)

        /** m/s2 away from the average of the [MEAN] readings before. */
        const val ACTIVE_ACCEL = 0.8

        /** rad/s. */
        const val ACTIVE_GYRO = 0.6

        /** Readings averaged (240 ms at 50 Hz). */
        const val MEAN = 12

        /** A stretch is over after this many calm readings in a row. */
        const val QUIET = 12

        /** Readings kept on each side of a stretch. */
        const val PAD = 4

        /** Readings before the padding that give the resting value. */
        const val BASE = 6

        /** Readings before the stretch in which the wrist must be calm. */
        const val BEFORE = 15

        /** A stretch longer than this is ordinary movement. */
        const val MAX_READINGS = 95

        /** A hole this long in the readings starts everything over. */
        const val MAX_GAP_NS = 100_000_000L

        /** Readings remembered while nothing moves. */
        const val KEPT = PAD + BEFORE + 1

        /** rad/s allowed in the [BEFORE] readings. */
        const val BEFORE_LIMIT = 1.0

        /** rad/s allowed during the stretch. A gesture goes far over. */
        const val GYRO_LIMIT = 2.2

        /** Degrees the watch may turn during the stretch. */
        const val TURN_LIMIT = 40.0

        /** m/s of the first push for a shove left or right. Ordinary arm movement pushes sideways too, so this is the higher bar. */
        const val SPEED_SIDE = 0.40

        /** m/s of the first push for a shove up or down. */
        const val SPEED_UP_DOWN = 0.30

        /** Share of the first push that must lie along its main axis. */
        const val PURE = 0.85

        /** Shortest and longest stretch. */
        const val MIN_NS = 300_000_000L
        const val MAX_NS = 1_600_000_000L

        /** The first peak must reach this share of the fastest moment. */
        const val PEAK_SHARE = 0.6

        /** After a shove, no new one for this long: the hand is coming back. */
        const val REST_NS = 600_000_000L
    }

    /**
     * What became of one stretch of movement. [direction] is null when it was no shove, and
     * [reason] then says why. [speed] is the first push along its main [axis] (0, 1, 2 for the
     * watch's x, y, z, or -1 when it was not worked out), in m/s with its sign.
     */
    class Outcome(
        val direction: Gesture?,
        val startNs: Long,
        val endNs: Long,
        val reason: String,
        val speed: Double = 0.0,
        val axis: Int = -1,
        val turned: Double = 0.0,
        val gyroPeak: Double = 0.0
    ) {
        /** A short text for the log, without commas. */
        fun detail(): String {
            val letter = if (axis >= 0) "xyz"[axis] else '-'
            val text = "%s%+.2f;gyro%.1f;turn%.0f;%.0fms".format(Locale.US, letter, speed, gyroPeak, turned, (endNs - startNs) / 1e6)
            return if (reason.isEmpty()) text else text + ";" + reason.replace(' ', '_')
        }
    }

    private class Reading(val t: Long, val ax: Double, val ay: Double, val az: Double, val wx: Double, val wy: Double, val wz: Double)

    private var gx = 0.0
    private var gy = 0.0
    private var gz = 0.0

    /** The last [KEPT] readings. */
    private val ring = ArrayList<Reading>(KEPT + 1)

    /** Readings of the open stretch, or null. */
    private var segment: ArrayList<Reading>? = null

    /** Index in the stretch of its last active reading. */
    private var lastActive = 0
    private var quiet = 0

    /** The open stretch has already been turned down. */
    private var dead = false
    private var baseX = 0.0
    private var baseY = 0.0
    private var baseZ = 0.0
    private var gyroPeak = 0.0
    private var restUntil = Long.MIN_VALUE

    /** True while a stretch of movement is open. */
    val moving: Boolean get() = segment != null

    /** True while a stretch is open that could still turn out to be a shove. */
    val possible: Boolean get() = segment != null && !dead

    /** When the open stretch began, or -1. */
    val since: Long get() = segment?.get(0)?.t ?: -1L

    /** One gyro event as the watch delivers it. The values go through the same text form as the CSVs. */
    fun gyro(event: SensorEventRecord) {
        gyro(event.timestampNs, MotionClip.csvValue(event.x), MotionClip.csvValue(event.y), MotionClip.csvValue(event.z))
    }

    /** One accelerometer event as the watch delivers it. */
    fun accel(event: SensorEventRecord): Outcome? =
        accel(event.timestampNs, MotionClip.csvValue(event.x), MotionClip.csvValue(event.y), MotionClip.csvValue(event.z))

    /** One gyro event. Only remembered: the next accelerometer event uses it. */
    @Suppress("UNUSED_PARAMETER")
    fun gyro(timestampNs: Long, x: Double, y: Double, z: Double) {
        gx = x
        gy = y
        gz = z
    }

    /**
     * One accelerometer event. Returns an [Outcome] when a stretch was judged, otherwise null.
     * A stretch that cannot be a shove any more is turned down at once, without waiting for it
     * to end. A shove is only announced when the stretch is over.
     */
    fun accel(timestampNs: Long, x: Double, y: Double, z: Double): Outcome? {
        if (ring.isNotEmpty()) {
            val gap = timestampNs - ring[ring.size - 1].t
            if (gap <= 0L) return null // same instant twice: keep the first
            if (gap > MAX_GAP_NS) {
                // A hole in the readings: nothing before it can be trusted.
                var cut: Outcome? = null
                val stretch = segment
                if (stretch != null && !dead) cut = Outcome(null, stretch[0].t, ring[ring.size - 1].t, "gap", gyroPeak = gyroPeak)
                ring.clear()
                segment = null
                dead = false
                ring.add(Reading(timestampNs, x, y, z, gx, gy, gz))
                return cut
            }
        }
        val reading = Reading(timestampNs, x, y, z, gx, gy, gz)
        val turning = sqrt(gx * gx + gy * gy + gz * gz)

        var active = false
        if (ring.size >= MEAN) {
            var mx = 0.0
            var my = 0.0
            var mz = 0.0
            for (i in ring.size - MEAN until ring.size) {
                mx += ring[i].ax
                my += ring[i].ay
                mz += ring[i].az
            }
            val dx = x - mx / MEAN
            val dy = y - my / MEAN
            val dz = z - mz / MEAN
            active = sqrt(dx * dx + dy * dy + dz * dz) > ACTIVE_ACCEL || turning > ACTIVE_GYRO
        }

        var outcome: Outcome? = null
        val stretch = segment
        if (stretch == null) {
            if (active && ring.size >= KEPT) outcome = begin(reading, turning)
        } else {
            if (!dead) stretch.add(reading) // a stretch that was turned down is not kept any longer
            if (active) {
                lastActive = stretch.size - 1
                quiet = 0
                if (turning > gyroPeak) gyroPeak = turning
                if (!dead) {
                    if (turning >= GYRO_LIMIT) {
                        outcome = turnDown("turning")
                    } else if (stretch.size > MAX_READINGS) {
                        outcome = turnDown("long")
                    }
                }
            } else {
                quiet++
                if (quiet >= QUIET) {
                    if (!dead) outcome = judge()
                    segment = null
                    dead = false
                }
            }
        }

        ring.add(reading)
        if (ring.size > KEPT) ring.removeAt(0)
        return outcome
    }

    /** Starts a stretch at [reading], with the [PAD] readings before it. */
    private fun begin(reading: Reading, turning: Double): Outcome? {
        val size = ring.size
        var bx = 0.0
        var by = 0.0
        var bz = 0.0
        for (i in size - PAD - BASE until size - PAD) {
            bx += ring[i].ax
            by += ring[i].ay
            bz += ring[i].az
        }
        baseX = bx / BASE
        baseY = by / BASE
        baseZ = bz / BASE
        var before = 0.0
        for (i in size - PAD - BEFORE until size - PAD) {
            val w = sqrt(ring[i].wx * ring[i].wx + ring[i].wy * ring[i].wy + ring[i].wz * ring[i].wz)
            if (w > before) before = w
        }
        val started = ArrayList<Reading>(MAX_READINGS + PAD + 2)
        for (i in size - PAD until size) started.add(ring[i])
        started.add(reading)
        segment = started
        lastActive = PAD
        quiet = 0
        dead = false
        gyroPeak = turning
        val start = started[0].t
        if (start < restUntil) return turnDown("rest")
        if (before > BEFORE_LIMIT) return turnDown("moving before")
        if (turning >= GYRO_LIMIT) return turnDown("turning")
        return null
    }

    /** The open stretch cannot be a shove. It stays open until the movement ends. */
    private fun turnDown(reason: String): Outcome {
        dead = true
        val stretch = segment!!
        return Outcome(null, stretch[0].t, stretch[stretch.size - 1].t, reason, gyroPeak = gyroPeak)
    }

    /** The stretch is over: work out the first push and decide. */
    private fun judge(): Outcome {
        val stretch = segment!!
        val count = lastActive + 1 + PAD
        val start = stretch[0].t
        val end = stretch[count - 1].t

        // The hand's velocity in the frame the watch started in.
        var turn = doubleArrayOf(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
        val vx = DoubleArray(count)
        val vy = DoubleArray(count)
        val vz = DoubleArray(count)
        var turned = 0.0
        for (i in 1 until count) {
            val r = stretch[i]
            val dt = (r.t - stretch[i - 1].t) / 1e9
            turn = times(turn, rotation(r.wx, r.wy, r.wz, dt))
            vx[i] = vx[i - 1] + (turn[0] * r.ax + turn[1] * r.ay + turn[2] * r.az - baseX) * dt
            vy[i] = vy[i - 1] + (turn[3] * r.ax + turn[4] * r.ay + turn[5] * r.az - baseY) * dt
            vz[i] = vz[i - 1] + (turn[6] * r.ax + turn[7] * r.ay + turn[8] * r.az - baseZ) * dt
            val cosine = (turn[0] + turn[4] + turn[8] - 1.0) / 2.0
            val angle = acos(maxOf(-1.0, minOf(1.0, cosine))) * 180.0 / Math.PI
            if (angle > turned) turned = angle
        }

        // Out and back: the hand ends at rest, so whatever velocity is left over is drift. Spread it out.
        val span = (end - start).toDouble()
        val ex = vx[count - 1]
        val ey = vy[count - 1]
        val ez = vz[count - 1]
        val speeds = DoubleArray(count)
        var fastest = 0.0
        for (i in 0 until count) {
            val share = (stretch[i].t - start) / span
            vx[i] -= share * ex
            vy[i] -= share * ey
            vz[i] -= share * ez
            speeds[i] = sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i])
            if (speeds[i] > fastest) fastest = speeds[i]
        }

        // The first push: the first peak of the speed that is a real one.
        var peak = -1
        for (i in 1 until count - 1) {
            if (speeds[i] >= PEAK_SHARE * fastest && speeds[i] >= speeds[i - 1] && speeds[i] >= speeds[i + 1]) {
                peak = i
                break
            }
        }
        if (peak < 0) {
            peak = 0
            for (i in 0 until count) {
                if (speeds[i] > speeds[peak]) peak = i
            }
        }
        val push = doubleArrayOf(vx[peak], vy[peak], vz[peak])
        var axis = 0
        if (abs(push[1]) > abs(push[axis])) axis = 1
        if (abs(push[2]) > abs(push[axis])) axis = 2
        val speed = push[axis]
        val pure = if (speeds[peak] > 0.0) abs(speed) / speeds[peak] else 0.0

        val reason = when {
            end - start < MIN_NS -> "short"
            end - start > MAX_NS -> "long"
            turned >= TURN_LIMIT -> "turned"
            axis == 0 -> "along the arm"
            abs(speed) < (if (axis == 1) SPEED_SIDE else SPEED_UP_DOWN) -> "slow"
            pure < PURE -> "mixed"
            else -> ""
        }
        if (reason.isNotEmpty()) return Outcome(null, start, end, reason, speed, axis, turned, gyroPeak)
        val direction = if (axis == 1) {
            if (speed > 0.0) Gesture.SHOVE_LEFT else Gesture.SHOVE_RIGHT
        } else {
            if (speed > 0.0) Gesture.SHOVE_UP else Gesture.SHOVE_DOWN
        }
        restUntil = end + REST_NS
        return Outcome(direction, start, end, "", speed, axis, turned, gyroPeak)
    }

    /** The turn made by spinning at ([wx], [wy], [wz]) rad/s for [dt] seconds, as a 3x3 matrix in row order. */
    private fun rotation(wx: Double, wy: Double, wz: Double, dt: Double): DoubleArray {
        val size = sqrt(wx * wx + wy * wy + wz * wz)
        val angle = size * dt
        if (angle < 1e-12) return doubleArrayOf(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
        val kx = wx / size
        val ky = wy / size
        val kz = wz / size
        val s = sin(angle)
        val c = 1.0 - cos(angle)
        return doubleArrayOf(
            1.0 - c * (ky * ky + kz * kz), -s * kz + c * kx * ky, s * ky + c * kx * kz,
            s * kz + c * kx * ky, 1.0 - c * (kx * kx + kz * kz), -s * kx + c * ky * kz,
            -s * ky + c * kx * kz, s * kx + c * ky * kz, 1.0 - c * (kx * kx + ky * ky)
        )
    }

    /** The 3x3 matrix product [a] [b], both in row order. */
    private fun times(a: DoubleArray, b: DoubleArray): DoubleArray = doubleArrayOf(
        a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
        a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
        a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8]
    )
}
