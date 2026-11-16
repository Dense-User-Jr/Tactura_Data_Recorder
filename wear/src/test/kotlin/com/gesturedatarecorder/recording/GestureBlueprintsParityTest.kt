package com.gesturedatarecorder.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.abs

/**
 * Guards the contract between the watch and the laptop for steps 4 to 6 of the v2 recipe:
 * GestureBlueprints.kt must build the same blueprints, reach the same decisions and make the same
 * updates as ML/blueprint_reference.py, starting from the same real recordings.
 *
 * Reference values come from `python ML/dump_reference_blueprints.py`.
 */
class GestureBlueprintsParityTest {
    private val repoRoot = listOf("..", ".")
        .map(::File)
        .first { File(it, "recordings/GestureDataRecorder").isDirectory }

    private val lines: List<List<String>> by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("reference_blueprints.csv")
        assertNotNull("reference_blueprints.csv missing; run python ML/dump_reference_blueprints.py", stream)
        stream!!.bufferedReader().readLines().filter { it.isNotBlank() }.map { it.split(',') }
    }

    /** Blueprints rebuilt by the Kotlin code from the files the reference lists. */
    private val blueprints: Map<String, GestureBlueprints.Blueprint> by lazy {
        lines.filter { it[0] == "F" }.associate { cells ->
            cells[1] to GestureBlueprints.build(cells[2].split(';').map { file -> clipOf(file)!! })
        }
    }

    /** Parses a recorder CSV back into events, in row (arrival) order. */
    private fun parse(file: String): List<SensorEventRecord> {
        val rows = File(repoRoot, file).readText().replace("\r\n", "\n").lines().filter { it.isNotBlank() }
        val header = rows.first().split(',')
        val column = header.withIndex().associate { (index, name) -> name to index }
        return rows.drop(1).map { row ->
            val cells = row.split(',')
            val kind = SensorKind.entries.first { it.csvName == cells[column.getValue("source_sensor")] }
            val prefix = if (kind == SensorKind.ACCELEROMETER) "accel" else "gyro"
            SensorEventRecord(
                kind = kind,
                timestampNs = cells[column.getValue("sensor_timestamp_ns")].toLong(),
                x = cells[column.getValue("${prefix}_x")].toFloat(),
                y = cells[column.getValue("${prefix}_y")].toFloat(),
                z = cells[column.getValue("${prefix}_z")].toFloat()
            )
        }
    }

    private fun clipOf(file: String): Array<DoubleArray>? = MotionClip.extract(parse(file)).clip

    /** One clip per strong stroke in the window, loudest first. Empty for a quiet wrist. */
    private fun clipsOf(file: String): List<Array<DoubleArray>> = MotionClip.extract(parse(file)).clips

    private fun assertSameBlueprint(
        what: String,
        expectedCount: Int,
        expectedSize: Double,
        expectedMean: List<String>,
        actual: GestureBlueprints.Blueprint
    ) {
        assertEquals("$what: rep count", expectedCount, actual.count)
        assertEquals("$what: size", expectedSize, actual.size, TOLERANCE)
        assertEquals("$what: mean length", 3 * MotionClip.CLIP_LEN, expectedMean.size)
        for (axis in 0..2) {
            for (i in 0 until MotionClip.CLIP_LEN) {
                assertEquals(
                    "$what: axis $axis reading $i differs from Python",
                    expectedMean[axis * MotionClip.CLIP_LEN + i].toDouble(),
                    actual.mean[axis][i],
                    TOLERANCE
                )
            }
        }
    }

    @Test
    fun blueprintsMatchPythonReference() {
        val expected = lines.filter { it[0] == "B" }
        assertTrue("no reference blueprints", expected.isNotEmpty())
        for (cells in expected) {
            val actual = blueprints[cells[1]]
            assertNotNull("${cells[1]}: no blueprint built", actual)
            assertSameBlueprint(cells[1], cells[2].toInt(), cells[3].toDouble(), cells.drop(4), actual!!)
        }
    }

    @Test
    fun decisionsMatchPythonReference() {
        val expected = lines.filter { it[0] == "T" }
        assertTrue("no reference decisions", expected.isNotEmpty())
        assertTrue("reference never says NONE", expected.any { it[2] == "NONE" })
        for (cells in expected) {
            val file = cells[1]
            val match = GestureBlueprints.classify(clipOf(file), blueprints)
            assertEquals("$file: decision", cells[2], match.gesture ?: "NONE")
            val distance = cells[3].toDouble()
            if (distance.isInfinite()) {
                assertTrue("$file: Python saw a quiet wrist", match.distance.isInfinite())
            } else {
                assertEquals("$file: distance", distance, match.distance, TOLERANCE)
            }
        }
    }

    @Test
    fun decisionsWithEveryStrongStrokeMatchPythonReference() {
        val expected = lines.filter { it[0] == "M" }
        assertTrue("no reference decisions for several clips", expected.isNotEmpty())
        var several = 0
        for (cells in expected) {
            val file = cells[1]
            val clips = clipsOf(file)
            if (clips.size > 1) several++
            val match = GestureBlueprints.classifyClips(clips, blueprints)
            assertEquals("$file: decision", cells[2], match.gesture ?: "NONE")
            val distance = cells[3].toDouble()
            if (distance.isInfinite()) {
                assertTrue("$file: Python saw a quiet wrist", match.distance.isInfinite())
            } else {
                assertEquals("$file: distance", distance, match.distance, TOLERANCE)
            }
        }
        assertTrue("no test file has more than one strong stroke", several > 0)
    }

    /** Two blueprints per gesture: the reference one, and one built from the files the G line lists. */
    private val versions: Map<String, List<GestureBlueprints.Blueprint>> by lazy {
        lines.filter { it[0] == "G" }.associate { cells ->
            val second = GestureBlueprints.build(cells[2].split(';').map { file -> clipOf(file)!! })
            cells[1] to listOf(blueprints.getValue(cells[1]), second)
        }
    }

    @Test
    fun decisionsWithSeveralBlueprintsMatchPythonReference() {
        assertEquals("a second blueprint for every gesture", blueprints.keys, versions.keys)
        val expected = lines.filter { it[0] == "V" }
        assertTrue("no reference decisions for several blueprints", expected.isNotEmpty())
        var later = 0
        for (cells in expected) {
            val file = cells[1]
            val match = GestureBlueprints.classifyVersions(clipsOf(file), versions)
            assertEquals("$file: decision", cells[2], match.gesture ?: "NONE")
            assertEquals("$file: which blueprint decided", cells[4].toInt(), match.version)
            val distance = cells[3].toDouble()
            if (distance.isInfinite()) {
                assertTrue("$file: Python saw a quiet wrist", match.distance.isInfinite())
            } else {
                assertEquals("$file: distance", distance, match.distance, TOLERANCE)
            }
            if (match.version > 0) later++
        }
        assertTrue("no test file was decided by the second blueprint", later > 0)
    }

    /** Notes per gesture: the clips the N lines list, each as file:position among the file's clips. */
    private val notes: Map<String, List<Array<DoubleArray>>> by lazy {
        lines.filter { it[0] == "N" }.associate { cells ->
            cells[1] to cells.getOrElse(2) { "" }.split(';').filter { it.isNotEmpty() }.map { item ->
                clipsOf(item.substringBeforeLast(':'))[item.substringAfterLast(':').toInt()]
            }
        }
    }

    @Test
    fun decisionsWithNotesMatchPythonReference() {
        val expected = lines.filter { it[0] == "X" }
        assertTrue("no reference decisions with notes", expected.isNotEmpty())
        var refused = 0
        var named = 0
        for (cells in expected) {
            val file = cells[1]
            val match = GestureBlueprints.classifyVersions(clipsOf(file), versions, notes = notes)
            assertEquals("$file: decision with notes", cells[2], match.gesture ?: "NONE")
            assertEquals("$file: refused by a note", cells[3] == "1", match.ignoredByNote)
            if (match.ignoredByNote) refused++
            if (match.gesture != null) named++
        }
        assertTrue("no test file was refused by a note", refused > 0)
        assertTrue("no test file was still named with notes", named > 0)
    }

    @Test
    fun twoNotesAreNotAPatternAndThreeAre() {
        val single = blueprints.mapValues { listOf(it.value) }
        val file = lines.first { it[0] == "M" && it[2] != "NONE" }[1]
        val clips = clipsOf(file)
        val plain = GestureBlueprints.classifyVersions(clips, single)
        val gesture = plain.gesture!!
        assertEquals("the nearest gesture is the one named", gesture, plain.nearest)
        val clip = clips[plain.clip]

        assertFalse(GestureBlueprints.refusedByNotes(clip, listOf(clip, clip)))
        assertTrue(GestureBlueprints.refusedByNotes(clip, listOf(clip, clip, clip)))

        val two = GestureBlueprints.classifyVersions(clips, single, notes = mapOf(gesture to listOf(clip, clip)))
        assertEquals("two notes change nothing", gesture, two.gesture)
        val three = GestureBlueprints.classifyVersions(clips, single, notes = mapOf(gesture to listOf(clip, clip, clip)))
        assertNull("three alike notes refuse it", three.gesture)
        assertTrue(three.ignoredByNote)
        assertEquals("it still says which gesture it looked like", gesture, three.nearest)

        // Notes belong to one gesture. The same three on another gesture change nothing.
        val other = blueprints.keys.first { it != gesture }
        val elsewhere = GestureBlueprints.classifyVersions(clips, single, notes = mapOf(other to listOf(clip, clip, clip)))
        assertEquals(gesture, elsewhere.gesture)
    }

    @Test
    fun oneBlueprintPerGestureDecidesLikeClassifyClips() {
        val single = blueprints.mapValues { listOf(it.value) }
        for (cells in lines.filter { it[0] == "M" }) {
            val clips = clipsOf(cells[1])
            val one = GestureBlueprints.classifyClips(clips, blueprints)
            val several = GestureBlueprints.classifyVersions(clips, single)
            assertEquals("${cells[1]}: decision", one.gesture, several.gesture)
            if (clips.isEmpty()) {
                assertEquals("${cells[1]}: nothing to compare", -1, several.version)
            } else {
                assertEquals("${cells[1]}: distance", one.distance, several.distance, 0.0)
                assertEquals("${cells[1]}: the only blueprint decided", 0, several.version)
            }
        }
        val nothing = GestureBlueprints.classifyVersions(clipsOf(lines.first { it[0] == "M" }[1]), emptyMap())
        assertNull(nothing.gesture)
        assertEquals(-1, nothing.version)
    }

    @Test
    fun chosenCalibrationClipsMatchPythonReference() {
        val expected = lines.filter { it[0] == "C" }
        assertTrue("no reference clip choices", expected.isNotEmpty())
        assertTrue("reference never keeps a clip other than the first", expected.any { it[4] != "0" })
        val repsByGesture = lines.filter { it[0] == "F" }.associate { cells ->
            cells[1] to cells[2].split(';').map { file -> clipOf(file)!! }
        }
        for (cells in expected) {
            val clips = clipsOf(cells[2])
            assertEquals("${cells[2]}: number of clips", cells[3].toInt(), clips.size)
            val chosen = GestureBlueprints.chooseClip(clips, repsByGesture.getValue(cells[1]))
            assertEquals("${cells[2]}: clip kept", cells[4].toInt(), chosen)
        }
    }

    @Test
    fun oneClipDecidesLikeClassify() {
        for (cells in lines.filter { it[0] == "T" }) {
            val clip = clipOf(cells[1]) ?: continue
            val single = GestureBlueprints.classify(clip, blueprints)
            val listed = GestureBlueprints.classifyClips(listOf(clip), blueprints)
            assertEquals("${cells[1]}: decision", single.gesture, listed.gesture)
            assertEquals("${cells[1]}: distance", single.distance, listed.distance, 0.0)
        }
        assertEquals(0, GestureBlueprints.chooseClip(listOf(blueprints.values.first().mean), emptyList()))
    }

    @Test
    fun eigengesturesMatchPythonReference() {
        val expected = lines.filter { it[0] == "E" }
        assertTrue("no reference eigengestures", expected.isNotEmpty())
        for (cells in expected) {
            val gesture = cells[1]
            val index = cells[2].toInt()
            val blueprint = blueprints.getValue(gesture)
            assertTrue("$gesture: eigengesture $index is missing", blueprint.directions.size > index)
            assertEquals("$gesture eigengesture $index: spread", cells[3].toDouble(), blueprint.spreads[index], TOLERANCE)
            val values = cells.drop(4)
            assertEquals("$gesture eigengesture $index: length", 3 * MotionClip.CLIP_LEN, values.size)
            // An eigengesture pointing the other way is the same eigengesture, so either sign may match.
            var same = 0.0
            var flipped = 0.0
            for (axis in 0..2) {
                for (i in 0 until MotionClip.CLIP_LEN) {
                    val want = values[axis * MotionClip.CLIP_LEN + i].toDouble()
                    val got = blueprint.directions[index][axis][i]
                    same = maxOf(same, abs(got - want))
                    flipped = maxOf(flipped, abs(got + want))
                }
            }
            assertTrue("$gesture eigengesture $index differs from Python by ${minOf(same, flipped)}", minOf(same, flipped) <= TOLERANCE)
        }
        for ((gesture, blueprint) in blueprints) {
            assertEquals("$gesture: eigengestures kept", expected.count { it[1] == gesture }, blueprint.directions.size)
        }
    }

    @Test
    fun aFaintCopyIsNotAGesture() {
        for ((gesture, blueprint) in blueprints) {
            // At 5% strength the plain distance is 95% of the blueprint's size, over the limit, so the
            // clip can only get close through forgiveness, and then it is far too weak to count.
            val faint = Array(3) { axis -> DoubleArray(MotionClip.CLIP_LEN) { i -> 0.05 * blueprint.mean[axis][i] } }
            val alone = mapOf(gesture to blueprint)
            assertNull("$gesture at 5% strength", GestureBlueprints.classify(faint, alone).gesture)
            assertNull("$gesture at 5% strength", GestureBlueprints.classifyClips(listOf(faint), alone).gesture)
            // A soft but honest copy passes the plain test, so the strength rule leaves it alone.
            val soft = Array(3) { axis -> DoubleArray(MotionClip.CLIP_LEN) { i -> 0.4 * blueprint.mean[axis][i] } }
            assertEquals("$gesture at 40% strength", gesture, GestureBlueprints.classify(soft, alone).gesture)
            val still = Array(3) { DoubleArray(MotionClip.CLIP_LEN) }
            assertNull("$gesture: no motion at all", GestureBlueprints.classify(still, alone).gesture)
        }
    }

    @Test
    fun updatesMatchPythonReference() {
        val expected = lines.filter { it[0] == "U" }
        assertTrue("no reference updates", expected.isNotEmpty())
        for (cells in expected) {
            val gesture = cells[1]
            val updated = GestureBlueprints.update(blueprints.getValue(gesture), clipOf(cells[2])!!)
            assertSameBlueprint("$gesture after one more rep", cells[3].toInt(), cells[4].toDouble(), cells.drop(5), updated)
        }
    }

    @Test
    fun calibrationCheckMatchesPythonReference() {
        val expected = lines.filter { it[0] == "W" }
        assertTrue("no reference calibration checks", expected.isNotEmpty())
        val repsByGesture = lines.filter { it[0] == "F" }.associate { cells ->
            cells[1] to cells[2].split(';').map { file -> clipOf(file)!! }
        }
        for (cells in expected) {
            val check = GestureBlueprints.worstRep(repsByGesture.getValue(cells[1]))
            assertEquals("${cells[1]}: least typical rep", cells[2].toInt(), check.index)
            assertEquals("${cells[1]}: its miss", cells[3].toDouble(), check.miss, TOLERANCE)
        }
    }

    @Test
    fun quietWristAndEmptyBlueprintsGiveNoGesture() {
        assertNull(GestureBlueprints.classify(null, blueprints).gesture)
        val anyClip = blueprints.values.first().mean
        assertNull(GestureBlueprints.classify(anyClip, emptyMap()).gesture)
        assertNull(GestureBlueprints.classifyClips(emptyList(), blueprints).gesture)
        assertNull(GestureBlueprints.classifyClips(listOf(anyClip), emptyMap()).gesture)
    }

    @Test
    fun aBlueprintMatchesItself() {
        for ((gesture, blueprint) in blueprints) {
            val match = GestureBlueprints.classify(blueprint.mean, blueprints)
            assertEquals(gesture, match.gesture)
            assertEquals(0.0, match.distance, TOLERANCE)
        }
    }

    private companion object {
        /** rad/s. Far below anything that matters, loose enough for the last binary digit. */
        const val TOLERANCE = 1e-9
    }
}
