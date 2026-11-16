package com.gesturedatarecorder.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The bundled word list (wear/src/main/assets/lexicon.csv) and the lookup that reads it. */
class LexiconTest {
    private val asset = listOf("src/main/assets/lexicon.csv", "wear/src/main/assets/lexicon.csv")
        .map(::File)
        .first { it.isFile }

    private fun entries(usable: List<Gesture>) = asset.useLines { Lexicon.parse(it, usable) }

    private fun key(vararg gestures: Gesture) = Lexicon.key(gestures.map { it.name })!!

    @Test
    fun gesturesSpellTheWordsOfTheSimulatorSpec() {
        val all = entries(Gesture.entries)
        assertEquals("this", Lexicon.exact(all, key(Gesture.FLICK_UP, Gesture.TWIST_LEFT, Gesture.SHAKE)).first())
        assertEquals("is", Lexicon.exact(all, key(Gesture.TWIST_LEFT, Gesture.SHAKE)).first())
        assertEquals("these", Lexicon.exact(all, key(Gesture.FLICK_UP, Gesture.TWIST_RIGHT, Gesture.SHAKE)).first())
        assertTrue("zip" in Lexicon.exact(all, key(Gesture.SHAKE, Gesture.TWIST_LEFT, Gesture.FLICK_DOWN)))
        assertEquals("cheese", Lexicon.exact(all, key(Gesture.DOUBLE_TAP, Gesture.TWIST_RIGHT, Gesture.SHAKE)).first())
    }

    @Test
    fun wordsThatShareGesturesComeMostCommonFirst() {
        val same = Lexicon.exact(entries(Gesture.entries), key(Gesture.FLICK_DOWN, Gesture.TWIST_RIGHT, Gesture.SHAKE))
        assertTrue("piece and peace share one sequence", "piece" in same && "peace" in same)
        assertEquals("the more common word is offered first", "piece", same.first())
    }

    @Test
    fun theFirstGesturesAlreadyOfferTheWordsTheyStart() {
        val five = entries(BlueprintStore.GESTURES)
        // Flick Up alone spells nothing, and starts "the", "this" and "these".
        val flickUp = key(Gesture.FLICK_UP)
        assertTrue(Lexicon.exact(five, flickUp).isEmpty())
        val started = Lexicon.longer(five, flickUp)
        assertEquals("the most common word comes first", "the", started.first())
        assertTrue("this" in started && "these" in started)
        // Flick Up, Twist Right spells "the" and still starts "these".
        val two = key(Gesture.FLICK_UP, Gesture.TWIST_RIGHT)
        assertEquals("the", Lexicon.exact(five, two).first())
        assertTrue("these" in Lexicon.longer(five, two))
        assertTrue("a word is not offered twice", Lexicon.longer(five, two).none { it in Lexicon.exact(five, two) })
        assertTrue("nothing starts with no gestures", Lexicon.longer(five, "").isEmpty())
    }

    @Test
    fun wordsThatNeedAnUncalibratedGestureAreLeftOut() {
        val five = entries(BlueprintStore.GESTURES)
        assertTrue("there are words to spell", five.size > 20)
        assertTrue("no word needs Double Tap", five.none { Lexicon.digit(Gesture.DOUBLE_TAP) in it.gestures })
        assertTrue(Lexicon.exact(five, key(Gesture.DOUBLE_TAP, Gesture.TWIST_RIGHT, Gesture.SHAKE)).isEmpty())
    }

    @Test
    fun anUnknownLabelGivesNoKey() {
        assertNull(Lexicon.key(listOf("FLICK_UP", "NOT_A_GESTURE")))
        assertEquals("15", Lexicon.key(listOf("FLICK_UP", "SHAKE")))
    }
}
