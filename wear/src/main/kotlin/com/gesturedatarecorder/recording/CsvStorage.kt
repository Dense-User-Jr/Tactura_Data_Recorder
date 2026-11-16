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

    /**
     * Calibration reps: /sdcard/Download/GestureCalibration. The label is what the user was asked
     * to do, so these are true-label recordings, kept apart from the Record-mode training set.
     */
    val CALIBRATION_DIR = Environment.DIRECTORY_DOWNLOADS + "/GestureCalibration/"

    /**
     * Corrections made with the Wrong? button: /sdcard/Download/GestureCorrections. One small
     * file per correction, naming the Classify window it corrects and what it really was.
     */
    val CORRECTIONS_DIR = Environment.DIRECTORY_DOWNLOADS + "/GestureCorrections/"

    /**
     * Listen-mode sessions: /sdcard/Download/GestureListen. Two files per session: the raw gyro
     * stream, and one line per burst with what the watch decided.
     */
    val LISTEN_DIR = Environment.DIRECTORY_DOWNLOADS + "/GestureListen/"

    fun listenStreamName(number: Int, startedAtWallMs: Long): String =
        "%04d_listen_stream_%s.csv".format(Locale.US, number, timestamp(startedAtWallMs))

    fun listenDecisionsName(number: Int, startedAtWallMs: Long): String =
        "%04d_listen_decisions_%s.csv".format(Locale.US, number, timestamp(startedAtWallMs))

    /** Name for a correction: what the watch [said] and what the user says it [was]. */
    fun correctionName(number: Int, said: String, was: String, wallMs: Long): String =
        "%04d_correction_said-%s_was-%s_%s.csv".format(
            Locale.US,
            number,
            said.lowercase(Locale.US),
            was.lowercase(Locale.US),
            timestamp(wallMs)
        )

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

    /** Name for a Classify window in which no known gesture was found. */
    fun classifyNoneName(number: Int, startedAtWallMs: Long): String =
        "%04d_classify_pred-none-0_%s.csv".format(Locale.US, number, timestamp(startedAtWallMs))

    fun calibrationName(number: Int, gesture: Gesture, startedAtWallMs: Long): String =
        "%04d_calib_%s_%s.csv".format(Locale.US, number, gesture.name.lowercase(Locale.US), timestamp(startedAtWallMs))

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
