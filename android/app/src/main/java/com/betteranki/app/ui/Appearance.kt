package com.betteranki.app.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import com.betteranki.app.R

enum class ThemeChoice(val label: String) { System("System"), Light("Light"), Dark("Dark") }

/** App fonts, the same choices as the web app's Settings › Appearance. Cards keep the fonts their note type sets. */
enum class FontChoice(val label: String, val family: FontFamily) {
    System("System", FontFamily.Default),
    Inter("Inter", InterFamily),
    Serif("Serif", FontFamily.Serif),
    Mono("Mono", FontFamily.Monospace),
}

/** Theme and font for this device. Not sensitive, so plain preferences; read before the first frame so nothing flashes. */
class Appearance(context: Context) {
    private val prefs = context.getSharedPreferences("appearance", Context.MODE_PRIVATE)
    var theme by mutableStateOf(ThemeChoice.entries.firstOrNull { it.name == prefs.getString("theme", null) } ?: ThemeChoice.System)
        private set
    var font by mutableStateOf(FontChoice.entries.firstOrNull { it.name == prefs.getString("font", null) } ?: FontChoice.System)
        private set

    fun updateTheme(t: ThemeChoice) { theme = t; prefs.edit().putString("theme", t.name).apply() }
    fun updateFont(f: FontChoice) { font = f; prefs.edit().putString("font", f.name).apply() }
}

val LocalAppearance = staticCompositionLocalOf<Appearance> { error("Appearance not provided") }
/** Whether the app is drawn dark: the theme setting, or the system's when it's "System". */
val LocalDark = staticCompositionLocalOf { false }

// Inter (SIL Open Font License, see assets/licenses/inter-OFL.txt): one variable file, a named instance per weight
private fun inter(w: Int) = Font(R.font.inter, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
private val InterFamily = FontFamily(inter(400), inter(500), inter(600), inter(700))
