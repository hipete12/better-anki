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
val NewBlue = Color(0xFF2563EB)
val LearnRed = Color(0xFFDC2626)
val DueGreen = Color(0xFF16A34A)
val AgainColor = Color(0xFFDC2626)
val HardColor = Color(0xFFB45309)
val GoodColor = Color(0xFF15803D)
val EasyColor = Color(0xFF2563EB)

/** Meaningful colors (card states, ratings, streak), with lighter steps for the dark surface. Same tokens as the web app. */
data class AppColors(val new: Color, val learn: Color, val due: Color, val again: Color, val hard: Color, val good: Color, val easy: Color, val streak: Color, val brand: Color, val faint: Color)
private val LightAppColors = AppColors(NewBlue, LearnRed, DueGreen, AgainColor, HardColor, GoodColor, EasyColor, Color(0xFFEA580C), BrandDark, Color(0xFF9A9DA8))
private val DarkAppColors = AppColors(Color(0xFF60A5FA), Color(0xFFF87171), Color(0xFF4ADE80), Color(0xFFF87171), Color(0xFFFBBF24), Color(0xFF4ADE80), Color(0xFF60A5FA), Color(0xFFFB923C), Color(0xFF818CF8), Color(0xFF6B6E7A))
val LocalAppColors = androidx.compose.runtime.staticCompositionLocalOf { LightAppColors }
val appColors: AppColors
    @Composable get() = LocalAppColors.current
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
    background = Color(0xFFF7F7F8),
    onBackground = Color(0xFF16171C),
    surface = Color.White,
    onSurface = Color(0xFF16171C),
    surfaceVariant = Color(0xFFF1F2F4),
    onSurfaceVariant = Color(0xFF61646F),
    outline = Color(0xFFE5E6EA),
    outlineVariant = Color(0xFFE5E6EA),
    surfaceContainer = Color.White,
    surfaceContainerHigh = Color(0xFFF1F2F4),
    surfaceContainerLow = Color.White,
)
private val Dark = darkColorScheme(
    primary = Color(0xFF818CF8),
    onPrimary = Color(0xFF0F1013),
    primaryContainer = Color(0xFF312E81),
    onPrimaryContainer = Color(0xFFE0E7FF),
    background = Color(0xFF0F1013),
    onBackground = Color(0xFFECECF0),
    surface = Color(0xFF16171B),
    onSurface = Color(0xFFECECF0),
    surfaceVariant = Color(0xFF1E2025),
    onSurfaceVariant = Color(0xFF9A9CA8),
    outline = Color(0xFF2A2C33),
    outlineVariant = Color(0xFF2A2C33),
    surfaceContainer = Color(0xFF16171B),
    surfaceContainerHigh = Color(0xFF1E2025),
    surfaceContainerLow = Color(0xFF16171B),
)

@Composable
fun BetterAnkiTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val base = Typography()
    androidx.compose.runtime.CompositionLocalProvider(LocalAppColors provides if (dark) DarkAppColors else LightAppColors) {
        MaterialTheme(
            colorScheme = if (dark) Dark else Light,
            typography = base.copy(
                headlineMedium = base.headlineMedium.copy(fontSize = 26.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp),
                titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold),
                labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium),
            ),
            content = content,
        )
    }
}
