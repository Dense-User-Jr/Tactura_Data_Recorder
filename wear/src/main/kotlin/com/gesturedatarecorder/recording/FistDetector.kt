package com.gesturedatarecorder.recording

import kotlin.math.sqrt

/**
 * Feels the hand close into a fist, which is how a word is chosen without touching the watch.
 *
 * Closing the hand sends a jolt up the wrist. The accelerometer shows it as a sudden jump from
 * one reading to the next, far bigger than a pinch or a still arm, while the wrist itself
 * hardly turns. So a fist is:
 *
 * 1. a jump of at least [JOLT] between two accelerometer readings,
 * 2. from a wrist that has stopped turning (gyro under [BEFORE_LIMIT] in the 0.15 s before),
 * 3. that does not turn into a real movement (gyro under [DURING_LIMIT] for the next 0.5 s),
 * 4. and is calm again right after (gyro under [AFTER_LIMIT] from 0.5 to 0.65 s).
 *
 * The answer therefore comes 0.65 s after the jolt. A jolt that is the start of a gesture is
 * turned down as soon as the wrist turns fast, without waiting.
 *
 * The numbers come from 10 recorded fists, 20 pinches, 4.5 minutes of ordinary listening and
 * the first evening of use on the watch (docs/gesture-recognition-v2-plan.md). They assume
 * about 50 readings a second.
 *
 * The watch's own buzz also shakes the accelerometer, by up to 4.1 m/s2. That is well under
 * [JOLT], so nothing has to be done about it here.
 * Not thread safe: call from one thread.
 */
class FistDetector {
    companion object {
        /** Accelerometer jump between two readings, in m/s2. Fists gave 5.6 to 20, pinches under 6.3, the watch's buzz under 4.2. */
        const val JOLT = 6.5

        /**
         * Gyro size allowed just before the jolt, in rad/s. A fist is usually made right after
         * rolling the cursor to a word, so the wrist only has to have slowed down, not be still.
         */
        const val BEFORE_LIMIT = 2.5

        /** Gyro size allowed from the jolt until [DURING_NS] after it. Fists stayed under 1.8. A gesture goes far over. */
        const val DURING_LIMIT = 2.5

        /** Gyro size allowed after that: the wrist must be calm again. */
        const val AFTER_LIMIT = 0.5

        const val BEFORE_FROM_NS = 150_000_000L
        const val BEFORE_TO_NS = 40_000_000L
        const val DURING_NS = 500_000_000L
        const val DECIDE_NS = 650_000_000L

        /** After a fist, no new one for this long: opening the hand again is a second jolt. */
        const val REST_NS = 1_000_000_000L

        private const val KEPT = 128
    }

    enum class Outcome { FIST, NOT_A_FIST }

    private var hasAccel = false
    private val lastAccel = DoubleArray(3)
    private val gyroTimes = LongArray(KEPT)
    private val gyroSizes = DoubleArray(KEPT)
    private var gyroCount = 0L
    private var joltAt = -1L
    private var restUntil = Long.MIN_VALUE

    /** True from a jolt until it has been judged. */
    val pending: Boolean get() = joltAt >= 0

    /** When the jolt being judged happened, or -1. */
    val pendingSince: Long get() = joltAt

    /**
     * One accelerometer reading. A big enough jump starts a judgement, but only when [armed]:
     * the caller turns that off when there is nothing to choose.
     */
    fun accel(timestampNs: Long, x: Double, y: Double, z: Double, armed: Boolean) {
        if (hasAccel && armed && joltAt < 0 && timestampNs >= restUntil) {
            val dx = x - lastAccel[0]
            val dy = y - lastAccel[1]
            val dz = z - lastAccel[2]
            if (sqrt(dx * dx + dy * dy + dz * dz) >= JOLT) joltAt = timestampNs
        }
        lastAccel[0] = x
        lastAccel[1] = y
        lastAccel[2] = z
        hasAccel = true
    }

    /** One gyro reading. Returns the judgement of a pending jolt once there is one, otherwise null. */
    fun gyro(timestampNs: Long, x: Double, y: Double, z: Double): Outcome? {
        val size = sqrt(x * x + y * y + z * z)
        val slot = (gyroCount % KEPT).toInt()
        gyroTimes[slot] = timestampNs
        gyroSizes[slot] = size
        gyroCount++
        val jolt = joltAt
        if (jolt < 0) return null
        // The wrist is turning fast: this jolt is the start of a gesture, not a fist.
        if (timestampNs < jolt + DURING_NS && size >= DURING_LIMIT) return judged(Outcome.NOT_A_FIST, timestampNs)
        if (timestampNs < jolt + DECIDE_NS) return null
        val fist = largest(jolt - BEFORE_FROM_NS, jolt - BEFORE_TO_NS) < BEFORE_LIMIT &&
            largest(jolt - BEFORE_TO_NS, jolt + DURING_NS) < DURING_LIMIT &&
            largest(jolt + DURING_NS, jolt + DECIDE_NS) < AFTER_LIMIT
        return judged(if (fist) Outcome.FIST else Outcome.NOT_A_FIST, timestampNs)
    }

    /** Drops a jolt that is being judged, for when the watch buzzes in the middle of it. */
    fun cancel() {
        joltAt = -1
    }

    private fun judged(outcome: Outcome, now: Long): Outcome {
        joltAt = -1
        if (outcome == Outcome.FIST) restUntil = now + REST_NS
        return outcome
    }

    /** The largest gyro size among the remembered readings from [from] up to, not including, [to]. */
    private fun largest(from: Long, to: Long): Double {
        var most = 0.0
        val kept = minOf(gyroCount, KEPT.toLong()).toInt()
        for (i in 0 until kept) {
            val t = gyroTimes[i]
            if (t >= from && t < to && gyroSizes[i] > most) most = gyroSizes[i]
        }
        return most
    }
}
