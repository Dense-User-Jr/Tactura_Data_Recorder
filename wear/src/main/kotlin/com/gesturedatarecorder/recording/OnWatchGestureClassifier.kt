package com.gesturedatarecorder.recording

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import android.content.Context
import android.os.SystemClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Runs the exported random forest (wear/src/main/assets/gesture_random_forest.onnx, produced by
 * ML/export_gesture_model.py) on a 192-value feature vector from [GestureFeatures].
 *
 * ONNX outputs: [0] label (string tensor), [1] class probabilities (zipmap disabled).
 */
class OnWatchGestureClassifier(modelBytes: ByteArray) {
    private val environment = OrtEnvironment.getEnvironment()
    private val session: OrtSession = environment.createSession(modelBytes)
    private val inputName: String = session.inputNames.first()

    init {
        val probabilityShape = (session.outputInfo.values.elementAtOrNull(1)?.info as? TensorInfo)?.shape
        val classCount = probabilityShape?.getOrNull(1)
        if (classCount != null && classCount > 0 && classCount.toInt() != MODEL_LABELS.size) {
            session.close()
            error(
                "Model has $classCount classes but MODEL_LABELS lists ${MODEL_LABELS.size}; " +
                    "update MODEL_LABELS in OnWatchGestureClassifier.kt to match model.classes_"
            )
        }
    }

    @Synchronized
    fun predict(features: FloatArray): GesturePrediction {
        require(features.size == GestureFeatures.FEATURE_COUNT) {
            "Expected ${GestureFeatures.FEATURE_COUNT} features, got ${features.size}"
        }
        OnnxTensor.createTensor(environment, arrayOf(features)).use { input ->
            session.run(mapOf(inputName to input)).use { result ->
                val probabilities = readProbabilities(result[1].value)
                val bestIndex = probabilities.indices.maxByOrNull { probabilities[it] } ?: 0
                val label = readLabel(result[0].value) ?: MODEL_LABELS.getOrElse(bestIndex) { "UNKNOWN" }
                return GesturePrediction(label, probabilities[bestIndex])
            }
        }
    }

    private fun readLabel(value: Any?): String? = (value as? Array<*>)?.firstOrNull()?.toString()

    private fun readProbabilities(value: Any?): FloatArray =
        when (val row = (value as? Array<*>)?.firstOrNull()) {
            is FloatArray -> row
            is DoubleArray -> FloatArray(row.size) { row[it].toFloat() }
            else -> error("Unexpected ONNX probability output: ${value?.javaClass?.simpleName}")
        }

    companion object {
        const val ASSET_NAME = "gesture_random_forest.onnx"

        /**
         * Fallback only (the model's own label output is preferred). Must equal scikit-learn's
         * `model.classes_`, which is sorted alphabetically. Add DOUBLE_TAP when it is trained.
         */
        private val MODEL_LABELS = arrayOf("FLICK_DOWN", "FLICK_UP", "SHAKE", "TWIST_LEFT", "TWIST_RIGHT")
    }
}

/**
 * Loads the classifier once per process, off the main thread. The instance is never closed:
 * it lives as long as the process, so no inference can race a close().
 */
object ModelStore {
    data class Loaded(val classifier: OnWatchGestureClassifier, val loadMs: Long)

    private val mutex = Mutex()
    private var loaded: Loaded? = null

    /** Returns the classifier and whether this call performed the (timed) load. */
    suspend fun get(context: Context): Pair<Loaded, Boolean> = mutex.withLock {
        loaded?.let { return it to false }
        val result = withContext(Dispatchers.Default) {
            val started = SystemClock.elapsedRealtime()
            val bytes = context.assets.open(OnWatchGestureClassifier.ASSET_NAME).use { it.readBytes() }
            val classifier = OnWatchGestureClassifier(bytes)
            Loaded(classifier, SystemClock.elapsedRealtime() - started)
        }
        loaded = result
        result to true
    }
}
