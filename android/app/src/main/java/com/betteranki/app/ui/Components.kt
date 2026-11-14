package com.betteranki.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) { content() }
}

@Composable
fun Loading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Brand) }
}

@Composable
fun ErrorBox(text: String, modifier: Modifier = Modifier) {
    Surface(modifier = modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), color = Color(0x1AEF4444)) {
        Text(text, modifier = Modifier.padding(12.dp), color = Color(0xFFDC2626), fontSize = 14.sp)
    }
}

@Composable
fun InfoBox(text: String, good: Boolean, modifier: Modifier = Modifier) {
    Surface(modifier = modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), color = if (good) Color(0x1A22C55E) else Color(0x1FF59E0B)) {
        Text(text, modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp), color = if (good) Color(0xFF15803D) else Color(0xFFB45309), fontSize = 12.sp, lineHeight = 16.sp)
    }
}

@Composable
fun CountsRow(new: Int, learn: Int, review: Int, highlight: String? = null) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        listOf(Triple(new, NewBlue, "new"), Triple(learn, LearnRed, "learn"), Triple(review, DueGreen, "review")).forEach { (n, c, k) ->
            Text(
                "$n",
                color = if (n > 0) c else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                fontWeight = if (n > 0) FontWeight.Bold else FontWeight.Normal,
                fontSize = 15.sp,
                textDecoration = if (highlight == k) androidx.compose.ui.text.style.TextDecoration.Underline else null,
            )
        }
    }
}

@Composable
fun <T> Dropdown(label: String, items: List<T>, selected: T?, itemLabel: (T) -> String, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 4.dp))
        Box {
            OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
                Text(selected?.let(itemLabel) ?: "Choose…", modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurface)
                Icon(Icons.Default.ArrowDropDown, null)
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                items.forEach { item ->
                    DropdownMenuItem(text = { Text(itemLabel(item)) }, onClick = { open = false; onSelect(item) })
                }
            }
        }
    }
}

@Composable
fun StatTile(label: String, value: String, sub: String, modifier: Modifier = Modifier) {
    Panel(modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            Text(value, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 2.dp))
            Text(sub, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun Dot(color: Color, size: Int = 8) {
    Box(Modifier.size(size.dp).background(color, RoundedCornerShape(50)))
}

fun fmtDuration(ms: Long): String {
    val s = ms / 1000
    if (s < 60) return "${s}s"
    val m = (s + 30) / 60
    if (m < 60) return "$m min"
    return String.format("%.1f h", m / 60.0)
}
