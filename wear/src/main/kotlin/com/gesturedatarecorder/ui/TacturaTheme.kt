package com.gesturedatarecorder.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.Typography
import com.gesturedatarecorder.R
import java.util.Locale

/*
 * The Tactura look, shared with the simulator (simulator/src/ui/styles/tokens.css, SPEC.md section 7).
 *
 * The rules, in one place:
 *  - Black screen, off-white ink, grey for anything secondary.
 *  - Signal red means "something just happened" or "something went wrong". Nothing else is red.
 *  - Success is white, not green.
 *  - Two typefaces: Doto (dot matrix) for the one big word on a screen, Space Mono for everything else.
 *  - Square corners, with one 45 degree cut on the top right of anything you can press.
 *  - Thin lines instead of filled boxes.
 */

/** Colors. Names match the simulator's tokens. */
internal object Ink {
    /** The spec says #0A0A0B. The watch uses true black so the round OLED screen has no visible edge. */
    val Bg = Color.Black
    val Surface = Color(0xFF111113)
    val Line = Color(0xFF2A2A2F)
    val LineStrong = Color(0xFF3D3D44)
    val Text = Color(0xFFF4F4F1)
    val Muted = Color(0xFF8C8C93)
    val Dim = Color(0xFF55555C)
    val Accent = Color(0xFFFF3B2F)
}

/** Dot matrix face for the big word on each screen. Only the Black weight is bundled. */
internal val Doto = FontFamily(Font(R.font.doto_black, FontWeight.Black))

/** Face for labels, buttons and small text. */
internal val Mono = FontFamily(
    Font(R.font.space_mono_regular, FontWeight.Normal),
    Font(R.font.space_mono_bold, FontWeight.Bold)
)

/** The signature corner cut. */
internal val Chamfer = CutCornerShape(topEnd = 10.dp)
internal val ChamferSmall = CutCornerShape(topEnd = 6.dp)

/** How long the red "just happened" flash takes to settle to white, and how long it holds first. */
internal const val FLASH_MS = 300
internal const val FLASH_HOLD_MS = 250

private val TacturaColors = Colors(
    primary = Ink.Text,
    primaryVariant = Ink.Muted,
    secondary = Ink.Text,
    secondaryVariant = Ink.Muted,
    background = Ink.Bg,
    surface = Ink.Surface,
    error = Ink.Accent,
    onPrimary = Color.Black,
    onSecondary = Color.Black,
    onBackground = Ink.Text,
    onSurface = Ink.Text,
    onSurfaceVariant = Ink.Muted,
    onError = Color.Black
)

@Composable
internal fun TacturaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = TacturaColors,
        typography = Typography(defaultFontFamily = Mono),
        content = content
    )
}

// ---------------------------------------------------------------- text

/** Small uppercase label: names, counts, states. One line. */
@Composable
internal fun Label(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Ink.Muted,
    sizeSp: Float = 10f,
    bold: Boolean = false
) {
    Text(
        text = text.uppercase(Locale.US),
        modifier = modifier,
        color = color,
        fontFamily = Mono,
        fontSize = sizeSp.sp,
        fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
        letterSpacing = 0.08.em,
        textAlign = TextAlign.Center,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
    )
}

/** A sentence, shown as written (not uppercased). Wraps onto several lines. */
@Composable
internal fun Note(text: String, modifier: Modifier = Modifier, color: Color = Ink.Muted, sizeSp: Float = 11f) {
    Text(
        text = text,
        modifier = modifier,
        color = color,
        fontFamily = Mono,
        fontSize = sizeSp.sp,
        lineHeight = (sizeSp * 1.3f).sp,
        textAlign = TextAlign.Center
    )
}

/** The one big dot matrix word on a screen. Put a line break in [text] to stack words. */
@Composable
internal fun Readout(text: String, sizeSp: Float, modifier: Modifier = Modifier, color: Color = Ink.Text) {
    Text(
        text = text.uppercase(Locale.US),
        modifier = modifier,
        color = color,
        fontFamily = Doto,
        fontWeight = FontWeight.Black,
        fontSize = sizeSp.sp,
        lineHeight = (sizeSp * 0.92f).sp,
        textAlign = TextAlign.Center,
        softWrap = false
    )
}

/** "Twist Right" becomes two stacked lines, so each word can be as big as the round screen allows. */
internal fun stacked(name: String): String = name.trim().replace(' ', '\n')

/**
 * The biggest Doto size at which the longest word of [text] still fits across [widthDp].
 * Every Doto letter is exactly 0.6 of the font size wide, so this is plain division.
 */
internal fun readoutSize(text: String, maxSp: Float = 44f, widthDp: Float = 144f): Float {
    val longest = text.split(' ', '\n').maxOf { it.length }.coerceAtLeast(1)
    return minOf(maxSp, widthDp / (0.6f * longest))
}

// ---------------------------------------------------------------- controls

/**
 * A pressable block with the cut corner.
 * [primary] fills it with ink. Use that for the one thing the screen most wants you to press.
 * [compact] is the small version used for Cancel and OK.
 */
@Composable
internal fun TacturaButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    detail: String? = null,
    primary: Boolean = false,
    enabled: Boolean = true,
    compact: Boolean = false
) {
    val filled = primary && enabled
    val shape = if (compact) ChamferSmall else Chamfer
    val ink = when {
        !enabled -> Ink.Dim
        filled -> Color.Black
        else -> Ink.Text
    }
    val edge = when {
        filled -> Ink.Text
        enabled -> Ink.LineStrong
        else -> Ink.Line
    }
    Column(
        modifier = modifier
            .clip(shape)
            .background(if (filled) Ink.Text else Color.Transparent)
            .border(1.dp, edge, shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .defaultMinSize(minHeight = if (compact) 34.dp else 46.dp)
            .padding(horizontal = if (compact) 16.dp else 14.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = label.uppercase(Locale.US),
            color = ink,
            fontFamily = Mono,
            fontWeight = FontWeight.Bold,
            fontSize = if (compact) 11.sp else 13.sp,
            letterSpacing = 0.08.em,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        if (detail != null) {
            Text(
                text = detail.uppercase(Locale.US),
                color = if (filled || !enabled) Ink.Dim else Ink.Muted,
                fontFamily = Mono,
                fontSize = 10.sp,
                letterSpacing = 0.08.em,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

/** One row of a pick-one list. A filled square marks the chosen row. [trailing] sits at the right edge. */
@Composable
internal fun SelectRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: String? = null,
    detail: String? = null
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .defaultMinSize(minHeight = 40.dp)
            .padding(start = 14.dp, end = 18.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .size(7.dp)
                .background(if (selected) Ink.Text else Color.Transparent)
                .border(1.dp, if (selected) Ink.Text else Ink.LineStrong)
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = label.uppercase(Locale.US),
                color = if (selected) Ink.Text else Ink.Muted,
                fontFamily = Mono,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                fontSize = 12.sp,
                letterSpacing = 0.08.em,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (detail != null) {
                Text(
                    text = detail.uppercase(Locale.US),
                    color = Ink.Dim,
                    fontFamily = Mono,
                    fontSize = 9.sp,
                    letterSpacing = 0.08.em,
                    maxLines = 1
                )
            }
        }
        if (trailing != null) {
            Label(trailing, color = if (selected) Ink.Muted else Ink.Dim)
        }
    }
}

/** A label followed by a thin line that runs to the edge. Starts a group in a list. */
@Composable
internal fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().padding(start = 14.dp, end = 18.dp, top = 10.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Label(text)
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f).height(1.dp).background(Ink.Line))
    }
}

/** Calibration progress as little squares. [newest] colors the most recent filled square. */
@Composable
internal fun RepBlocks(done: Int, total: Int, modifier: Modifier = Modifier, newest: Color = Ink.Text) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        repeat(total) { index ->
            val filled = index < done
            val fill = when {
                !filled -> Color.Transparent
                index == done - 1 -> newest
                else -> Ink.Text
            }
            Box(
                Modifier
                    .size(10.dp)
                    .background(fill)
                    .border(1.dp, if (filled) fill else Ink.LineStrong)
            )
        }
    }
}
