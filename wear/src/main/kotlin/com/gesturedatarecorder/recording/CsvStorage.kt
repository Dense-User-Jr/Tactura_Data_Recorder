package com.gesturedatarecorder.recording

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Writes capture CSVs to shared storage through MediaStore (no storage permission needed).
 *
 * Files are named `NNNN_<rest>.csv`, where NNNN is one more than the highest number among this
 * app's files in the same folder. Android 11+ only lets an app see MediaStore files it created,
 * so after an uninstall/reinstall numbering restarts at 0001; the timestamp keeps names unique.
 */
object CsvStorage {
    private const val TAG = "CsvStorage"

    /** Training recordings: /sdcard/Download/GestureDataRecorder */
    val RECORDINGS_DIR = Environment.DIRECTORY_DOWNLOADS + "/GestureDataRecorder/"

    /**
     * Classify-mode diagnostics: /sdcard/Download/GestureClassify. A sibling folder, not a
     * subfolder, so `adb pull .../GestureDataRecorder` never mixes predicted-label windows
     * into training data (the training script scans its input folder recursively).
     */
    val CLASSIFY_DIR = Environment.DIRECTORY_DOWNLOADS + "/GestureClassify/"

    fun recordingName(number: Int, gesture: Gesture, startedAtWallMs: Long): String =
        "%04d_%s_%s.csv".format(Locale.US, number, gesture.name.lowercase(Locale.US), timestamp(startedAtWallMs))

    fun classifyName(number: Int, prediction: GesturePrediction, startedAtWallMs: Long): String =
        "%04d_classify_pred-%s-%d_%s.csv".format(
            Locale.US,
            number,
            prediction.label.lowercase(Locale.US),
            (prediction.confidence * 100).toInt(),
            timestamp(startedAtWallMs)
        )

    /** Saves [content] and returns the file name, or null on failure. Call off the main thread. */
    fun save(context: Context, relativeDir: String, nameForNumber: (Int) -> String, content: String): String? {
        val resolver = context.contentResolver
        val fileName = nameForNumber(nextNumber(context, relativeDir))
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, "text/csv")
            put(MediaStore.Downloads.RELATIVE_PATH, relativeDir)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
        return try {
            resolver.openOutputStream(uri)?.use { stream ->
                stream.bufferedWriter().apply {
                    write(content)
                    flush()
                }
            } ?: error("Could not open $fileName")
            resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            fileName
        } catch (error: Exception) {
            Log.e(TAG, "Saving $fileName failed", error)
            resolver.delete(uri, null, null)
            null
        }
    }

    private fun nextNumber(context: Context, relativeDir: String): Int {
        var highest = 0
        context.contentResolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.Downloads.DISPLAY_NAME),
            "${MediaStore.Downloads.RELATIVE_PATH} = ?",
            arrayOf(relativeDir),
            null
        )?.use { cursor ->
            val nameIndex = cursor.getColumnIndexOrThrow(MediaStore.Downloads.DISPLAY_NAME)
            while (cursor.moveToNext()) {
                val number = cursor.getString(nameIndex)?.substringBefore('_')?.toIntOrNull() ?: continue
                highest = maxOf(highest, number)
            }
        }
        return highest + 1
    }

    private fun timestamp(wallMs: Long): String =
        SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date(wallMs))
}
