package com.gesturedatarecorder.recording

import android.content.res.AssetManager
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.Closeable

data class GesturePrediction(val label: String, val confidence: Float)

private data class SensorSample(
    val timeMs: Long,
    val x: Float,
    val y: Float,
    val z: Float
)

private const val WINDOW_MS = 3_000L
private const val BUFFER_MARGIN_MS = 500L
private const val TIME_BINS = 32
private const val FEATURE_COUNT = 192

class OnWatchGestureClassifier(assets: AssetManager) : Closeable {
    private val environment = OrtEnvironment.getEnvironment()
    private val session: OrtSession
    private val accelerometerSamples = mutableListOf<SensorSample>()
    private val gyroscopeSamples = mutableListOf<SensorSample>()

    init {
        val modelBytes = assets.open("gesture_random_forest.onnx").use { it.readBytes() }
        session = environment.createSession(modelBytes)
    }

    @Synchronized
    fun reset() {
        accelerometerSamples.clear()
        gyroscopeSamples.clear()
    }

    @Synchronized
    fun addAccelerometer(timeMs: Long, values: FloatArray) {
        accelerometerSamples += SensorSample(timeMs, values[0], values[1], values[2])
        trimSamples(timeMs)
    }

    @Synchronized
    fun addGyroscope(timeMs: Long, values: FloatArray) {
        gyroscopeSamples += SensorSample(timeMs, values[0], values[1], values[2])
        trimSamples(timeMs)
    }

    @Synchronized
    fun featuresIfReady(): FloatArray? {
        if (accelerometerSamples.isEmpty() || gyroscopeSamples.isEmpty()) return null
        val allTimes = accelerometerSamples.map { it.timeMs } + gyroscopeSamples.map { it.timeMs }
        val endMs = allTimes.maxOrNull() ?: return null
        val startMs = endMs - WINDOW_MS
        val firstTimeMs = allTimes.minOrNull() ?: return null
        if (firstTimeMs > startMs) return null
        val durationMs = WINDOW_MS.toDouble()
        val features = FloatArray(FEATURE_COUNT)
        var offset = 0
        for (component in 0..2) {
            offset = copyResampled(
                accelerometerSamples.filter { it.timeMs >= startMs },
                component,
                startMs,
                durationMs,
                features,
                offset
            )
        }
        for (component in 0..2) {
            offset = copyResampled(
                gyroscopeSamples.filter { it.timeMs >= startMs },
                component,
                startMs,
                durationMs,
                features,
                offset
            )
        }
        return features
    }

    fun predict(features: FloatArray): GesturePrediction {
        require(features.size == FEATURE_COUNT)
        val inputName = session.inputNames.first()
        OnnxTensor.createTensor(environment, arrayOf(features)).use { input ->
            session.run(mapOf(inputName to input)).use { result ->
                val label = readLabel(result[0].value)
                val probabilities = readProbabilities(result[1].value)
                val bestIndex = probabilities.indices.maxByOrNull { probabilities[it] } ?: 0
                return GesturePrediction(label ?: MODEL_LABELS[bestIndex], probabilities[bestIndex])
            }
        }
    }

    private fun trimSamples(latestTimeMs: Long) {
        val earliestAllowed = latestTimeMs - WINDOW_MS - BUFFER_MARGIN_MS
        accelerometerSamples.removeAll { it.timeMs < earliestAllowed }
        gyroscopeSamples.removeAll { it.timeMs < earliestAllowed }
    }

    private fun copyResampled(
        samples: List<SensorSample>,
        component: Int,
        startMs: Long,
        durationMs: Double,
        destination: FloatArray,
        offset: Int
    ): Int {
        val values = samples.map { sample ->
            val value = when (component) {
                0 -> sample.x
                1 -> sample.y
                else -> sample.z
            }
            (sample.timeMs - startMs) / durationMs to value.toDouble()
        }.sortedBy { it.first }
        val unique = mutableListOf<Pair<Double, Double>>()
        for ((time, value) in values) {
            val previous = unique.lastOrNull()
            if (previous != null && previous.first == time) {
                unique[unique.lastIndex] = time to ((previous.second + value) / 2.0)
            } else {
                unique += time to value
            }
        }
        for (index in 0 until TIME_BINS) {
            val position = index.toDouble() / (TIME_BINS - 1)
            destination[offset + index] = interpolate(unique, position).toFloat()
        }
        return offset + TIME_BINS
    }

    private fun interpolate(values: List<Pair<Double, Double>>, position: Double): Double {
        if (values.size == 1 || position <= values.first().first) return values.first().second
        if (position >= values.last().first) return values.last().second
        for (index in 1 until values.size) {
            val right = values[index]
            if (position <= right.first) {
                val left = values[index - 1]
                val fraction = (position - left.first) / (right.first - left.first)
                return left.second + fraction * (right.second - left.second)
            }
        }
        return values.last().second
    }

    private fun readLabel(value: Any?): String? = when (value) {
        is Array<*> -> value.firstOrNull()?.toString()
        else -> null
    }

    private fun readProbabilities(value: Any?): FloatArray = when (value) {
        is Array<*> -> {
            when (val row = value.firstOrNull()) {
                is FloatArray -> row
                is DoubleArray -> FloatArray(row.size) { row[it].toFloat() }
                else -> error("Unexpected ONNX probability output")
            }
        }
        else -> error("Unexpected ONNX probability output")
    }

    override fun close() {
        session.close()
    }

    companion object {
        private val MODEL_LABELS = arrayOf("FLICK_DOWN", "FLICK_UP", "SHAKE", "TWIST_LEFT", "TWIST_RIGHT")
    }
}