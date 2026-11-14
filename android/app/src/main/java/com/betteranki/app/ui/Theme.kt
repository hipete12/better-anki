package com.betteranki.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val Brand = Color(0xFF6366F1)
val BrandDark = Color(0xFF4F46E5)
val NewBlue = Color(0xFF3B82F6)
val LearnRed = Color(0xFFEF4444)
val DueGreen = Color(0xFF16A34A)
val AgainColor = Color(0xFFDC2626)
val HardColor = Color(0xFFD97706)
val GoodColor = Color(0xFF16A34A)
val EasyColor = Color(0xFF2563EB)
val FlagColors = listOf(Color.Transparent, Color(0xFFEF4444), Color(0xFFF97316), Color(0xFF22C55E), Color(0xFF3B82F6), Color(0xFFEC4899), Color(0xFF14B8A6), Color(0xFFA855F7))
val FlagNames = listOf("No flag", "Red", "Orange", "Green", "Blue", "Pink", "Turquoise", "Purple")
// validated categorical data-viz series (light / dark)
val SeriesLight = listOf(Color(0xFF2A78D6), Color(0xFFEB6834), Color(0xFF1BAF7A))
val SeriesDark = listOf(Color(0xFF3987E5), Color(0xFFD95926), Color(0xFF199E70))

private val Light = lightColorScheme(
    primary = BrandDark,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE0E7FF),
    onPrimaryContainer = Color(0xFF312E81),
    background = Color(0xFFF6F7FB),
    onBackground = Color(0xFF171A26),
    surface = Color.White,
    onSurface = Color(0xFF171A26),
    surfaceVariant = Color(0xFFF1F3F9),
    onSurfaceVariant = Color(0xFF687089),
    outline = Color(0xFFE3E6EF),
    outlineVariant = Color(0xFFE3E6EF),
    surfaceContainer = Color.White,
    surfaceContainerHigh = Color(0xFFF1F3F9),
    surfaceContainerLow = Color.White,
)
private val Dark = darkColorScheme(
    primary = Color(0xFF818CF8),
    onPrimary = Color(0xFF0E0F14),
    primaryContainer = Color(0xFF312E81),
    onPrimaryContainer = Color(0xFFE0E7FF),
    background = Color(0xFF0E0F14),
    onBackground = Color(0xFFE9EBF2),
    surface = Color(0xFF16181F),
    onSurface = Color(0xFFE9EBF2),
    surfaceVariant = Color(0xFF1D2029),
    onSurfaceVariant = Color(0xFF8D94AA),
    outline = Color(0xFF2A2E3A),
    outlineVariant = Color(0xFF2A2E3A),
    surfaceContainer = Color(0xFF16181F),
    surfaceContainerHigh = Color(0xFF1D2029),
    surfaceContainerLow = Color(0xFF16181F),
)

@Composable
fun BetterAnkiTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val base = Typography()
    MaterialTheme(
        colorScheme = if (dark) Dark else Light,
        typography = base.copy(
            headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
            titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold),
            labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium),
        ),
        content = content,
    )
}
