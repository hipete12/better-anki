package com.betteranki.app.ui

import android.content.Context
import android.view.KeyEvent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.betteranki.app.AppState

/** What a gesture, volume button or key can do while studying (AnkiDroid's set, minus the whiteboard and voice notes). */
enum class StudyAction(val label: String, val short: String = label) {
    NONE("Nothing", "–"),
    SHOW_ANSWER("Show answer", "Show answer"),
    AGAIN("Again", "Again"),
    HARD("Hard", "Hard"),
    GOOD("Good", "Good"),
    EASY("Easy", "Easy"),
    UNDO("Undo", "Undo"),
    EDIT("Edit note", "Edit"),
    MARK("Mark or unmark note", "Mark"),
    FLAG_RED("Toggle red flag", "Red flag"),
    FLAG_ORANGE("Toggle orange flag", "Orange flag"),
    FLAG_GREEN("Toggle green flag", "Green flag"),
    FLAG_BLUE("Toggle blue flag", "Blue flag"),
    FLAG_PINK("Toggle pink flag", "Pink flag"),
    FLAG_TURQUOISE("Toggle turquoise flag", "Turq. flag"),
    FLAG_PURPLE("Toggle purple flag", "Purple flag"),
    BURY_CARD("Bury card", "Bury"),
    BURY_NOTE("Bury note", "Bury note"),
    SUSPEND_CARD("Suspend card", "Suspend"),
    SUSPEND_NOTE("Suspend note", "Susp. note"),
    REPLAY("Replay audio", "Replay"),
    EXIT("Go back (leave study)", "Go back"),
    ;
    /** Again/Hard/Good/Easy: the rating (1-4), or 0. */
    val ease get() = when (this) { AGAIN -> 1; HARD -> 2; GOOD -> 3; EASY -> 4; else -> 0 }
    /** Flags: the flag number (1-7), or 0. */
    val flag get() = if (name.startsWith("FLAG_")) ordinal - FLAG_RED.ordinal + 1 else 0
}

/** Gestures on the card, and the volume buttons. Tap zones are a 3×3 grid over the card, like AnkiDroid's. */
enum class StudyGesture(val label: String) {
    DOUBLE_TAP("Double tap"),
    SWIPE_LEFT("Swipe left"),
    SWIPE_RIGHT("Swipe right"),
    SWIPE_UP("Swipe up"),
    SWIPE_DOWN("Swipe down"),
    TAP_TOP_LEFT("Tap top left"),
    TAP_TOP("Tap top"),
    TAP_TOP_RIGHT("Tap top right"),
    TAP_LEFT("Tap left"),
    TAP_CENTER("Tap center"),
    TAP_RIGHT("Tap right"),
    TAP_BOTTOM_LEFT("Tap bottom left"),
    TAP_BOTTOM("Tap bottom"),
    TAP_BOTTOM_RIGHT("Tap bottom right"),
    VOLUME_UP("Volume up"),
    VOLUME_DOWN("Volume down"),
    ;
    companion object {
        /** Tap zone 0-8 (rows of three, from the card page) to its gesture. */
        fun tap(zone: Int) = entries.getOrNull(TAP_TOP_LEFT.ordinal + zone)?.takeIf { it.name.startsWith("TAP_") }
        fun swipe(dir: String) = when (dir) { "left" -> SWIPE_LEFT; "right" -> SWIPE_RIGHT; "up" -> SWIPE_UP; "down" -> SWIPE_DOWN; else -> null }
    }
}

/** Gesture and volume-button bindings, saved on this device. Double tap undoes unless changed. */
class StudyControls(context: Context) {
    private val prefs = context.getSharedPreferences("gestures", Context.MODE_PRIVATE)
    private val map = mutableStateMapOf<StudyGesture, StudyAction>()
    init {
        for (g in StudyGesture.entries) {
            val saved = prefs.getString(g.name, null)?.let { s -> StudyAction.entries.firstOrNull { it.name == s } }
            map[g] = saved ?: DEFAULTS[g] ?: StudyAction.NONE
        }
    }
    operator fun get(g: StudyGesture) = map[g] ?: StudyAction.NONE
    fun set(g: StudyGesture, a: StudyAction) { map[g] = a; prefs.edit().putString(g.name, a.name).apply() }
    fun reset() { prefs.edit().clear().apply(); for (g in StudyGesture.entries) map[g] = DEFAULTS[g] ?: StudyAction.NONE }
    val bound get() = StudyGesture.entries.filter { get(it) != StudyAction.NONE }
    companion object {
        val DEFAULTS = mapOf(StudyGesture.DOUBLE_TAP to StudyAction.UNDO)
    }
}

val LocalStudyControls = staticCompositionLocalOf<StudyControls> { error("No StudyControls") }

/**
 * Keyboard and gamepad shortcuts while studying: AnkiDroid's defaults (which match Anki's). Answer keys only rate on
 * the answer side; Space/Enter show the answer, then answer Good.
 */
fun keyAction(e: KeyEvent, answerSide: Boolean): StudyAction? {
    val kc = e.keyCode
    if (e.isCtrlPressed) return when (kc) {
        KeyEvent.KEYCODE_Z -> if (e.isShiftPressed) null else StudyAction.UNDO
        in KeyEvent.KEYCODE_1..KeyEvent.KEYCODE_7 -> StudyAction.entries[StudyAction.FLAG_RED.ordinal + kc - KeyEvent.KEYCODE_1]
        in KeyEvent.KEYCODE_NUMPAD_1..KeyEvent.KEYCODE_NUMPAD_7 -> StudyAction.entries[StudyAction.FLAG_RED.ordinal + kc - KeyEvent.KEYCODE_NUMPAD_1]
        else -> null
    }
    // symbols first: '@' and '!' are Shift+2 and Shift+1
    when (e.getUnicodeChar(e.metaState).toChar()) {
        '*' -> return StudyAction.MARK
        '-' -> return StudyAction.BURY_CARD
        '=' -> return StudyAction.BURY_NOTE
        '@' -> return StudyAction.SUSPEND_CARD
        '!' -> return StudyAction.SUSPEND_NOTE
    }
    val rate = { a: StudyAction -> if (answerSide) a else null }
    return when (kc) {
        KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_DPAD_CENTER -> if (answerSide) StudyAction.GOOD else StudyAction.SHOW_ANSWER
        KeyEvent.KEYCODE_1, KeyEvent.KEYCODE_NUMPAD_1, KeyEvent.KEYCODE_BUTTON_Y -> rate(StudyAction.AGAIN)
        KeyEvent.KEYCODE_2, KeyEvent.KEYCODE_NUMPAD_2, KeyEvent.KEYCODE_BUTTON_X -> rate(StudyAction.HARD)
        KeyEvent.KEYCODE_3, KeyEvent.KEYCODE_NUMPAD_3, KeyEvent.KEYCODE_BUTTON_B -> rate(StudyAction.GOOD)
        KeyEvent.KEYCODE_4, KeyEvent.KEYCODE_NUMPAD_4, KeyEvent.KEYCODE_BUTTON_A -> rate(StudyAction.EASY)
        KeyEvent.KEYCODE_E -> StudyAction.EDIT
        KeyEvent.KEYCODE_R, KeyEvent.KEYCODE_F5 -> StudyAction.REPLAY
        else -> null
    }
}

private val KEYS = listOf(
    "Space or Enter" to "Show answer, then Good",
    "1  2  3  4" to "Again, Hard, Good, Easy",
    "Gamepad Y  X  B  A" to "Again, Hard, Good, Easy",
    "Ctrl+Z" to "Undo",
    "E" to "Edit note",
    "*" to "Mark or unmark note",
    "Ctrl+1 … Ctrl+7" to "Toggle red … purple flag",
    "-  /  =" to "Bury card / note",
    "@  /  !" to "Suspend card / note",
    "R or F5" to "Replay audio",
)

/** Settings → Gestures and keys. */
@Composable
fun GesturesScreen(app: AppState) {
    val controls = LocalStudyControls.current
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { app.pop() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Settings", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { controls.reset() }) { Text("Reset") }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Gestures and keys", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text("Choose what gestures on the card do while you study. They don't apply to links, audio buttons or the answer box.", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Double tap and swipes", fontWeight = FontWeight.SemiBold)
                    listOf(StudyGesture.DOUBLE_TAP, StudyGesture.SWIPE_LEFT, StudyGesture.SWIPE_RIGHT, StudyGesture.SWIPE_UP, StudyGesture.SWIPE_DOWN).forEach { g -> GestureRow(g, controls) }
                    Hint("Swipes up and down only count when the card doesn't scroll. With gesture navigation, a swipe that starts right at the edge of the screen is Android's Back, except in the middle of the card's sides, which is kept for swipes when one is set.")
                }
            }
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Taps", fontWeight = FontWeight.SemiBold)
                    Text("The card is split into nine areas. Tap one to choose what tapping there does.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp, bottom = 10.dp))
                    TapGrid(controls)
                    if (controls[StudyGesture.DOUBLE_TAP] != StudyAction.NONE && (0..8).any { controls[StudyGesture.tap(it)!!] != StudyAction.NONE })
                        Hint("Because double tap does something, a single tap waits a moment to make sure it isn't the start of a double tap.")
                }
            }
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Volume buttons", fontWeight = FontWeight.SemiBold)
                    GestureRow(StudyGesture.VOLUME_UP, controls)
                    GestureRow(StudyGesture.VOLUME_DOWN, controls)
                    Hint("Set to Nothing, they change the volume as usual.")
                }
            }
            Hint("Answer gestures show the answer first if it isn't showing yet.")
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Keyboard and gamepad", fontWeight = FontWeight.SemiBold)
                    Text("With a keyboard or gamepad connected, these work while studying (the same as Anki and AnkiDroid):", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp, bottom = 6.dp))
                    KEYS.forEachIndexed { i, (k, what) ->
                        if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
                        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                            Text(k, Modifier.width(150.dp), fontWeight = FontWeight.Medium, fontSize = 14.sp)
                            Text(what, Modifier.weight(1f), fontSize = 14.sp)
                        }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Hint(text: String) = Text(text, fontSize = 12.sp, lineHeight = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))

@Composable
private fun GestureRow(g: StudyGesture, controls: StudyControls) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable { open = true }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(g.label, Modifier.weight(1f), fontSize = 15.sp)
        Box {
            val a = controls[g]
            Text(a.label, fontSize = 14.sp, color = if (a == StudyAction.NONE) MaterialTheme.colorScheme.onSurfaceVariant else appColors.brand, fontWeight = if (a == StudyAction.NONE) FontWeight.Normal else FontWeight.Medium)
            ActionMenu(open, { open = false }, a) { controls.set(g, it) }
        }
    }
}

@Composable
private fun ActionMenu(open: Boolean, onDismiss: () -> Unit, current: StudyAction, onPick: (StudyAction) -> Unit) {
    DropdownMenu(open, onDismiss) {
        StudyAction.entries.forEach { a ->
            if (a == StudyAction.UNDO || a == StudyAction.EDIT || a == StudyAction.FLAG_RED || a == StudyAction.BURY_CARD || a == StudyAction.REPLAY) HorizontalDivider()
            DropdownMenuItem(
                text = { Text(a.label, fontWeight = if (a == current) FontWeight.SemiBold else FontWeight.Normal, color = if (a == current) appColors.brand else MaterialTheme.colorScheme.onSurface) },
                onClick = { onDismiss(); onPick(a) },
            )
        }
    }
}

@Composable
private fun TapGrid(controls: StudyControls) {
    Surface(shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth().aspectRatio(1.25f)) {
        Column {
            for (row in 0..2) {
                if (row > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.6f))
                Row(Modifier.weight(1f)) {
                    for (col in 0..2) {
                        if (col > 0) Box(Modifier.fillMaxHeight().width(1.dp).background(MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)))
                        val g = StudyGesture.tap(row * 3 + col)!!
                        var open by remember { mutableStateOf(false) }
                        val a = controls[g]
                        Box(Modifier.weight(1f).fillMaxSize().clickable { open = true }.background(if (a != StudyAction.NONE) appColors.brand.copy(alpha = 0.08f) else androidx.compose.ui.graphics.Color.Transparent), contentAlignment = Alignment.Center) {
                            Text(a.short, textAlign = TextAlign.Center, fontSize = 13.sp, lineHeight = 16.sp, color = if (a == StudyAction.NONE) appColors.faint else appColors.brand, fontWeight = if (a == StudyAction.NONE) FontWeight.Normal else FontWeight.Medium, modifier = Modifier.padding(4.dp))
                            ActionMenu(open, { open = false }, a) { controls.set(g, it) }
                        }
                    }
                }
            }
        }
    }
}
