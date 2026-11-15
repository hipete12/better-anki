package com.betteranki.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ShowChart
import androidx.compose.material.icons.filled.TableChart
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.betteranki.app.data.TrendDay
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.roundToInt

class ChartSeries(val label: String, val color: Color, val values: List<Int>)

/** Round up to a clean axis maximum (at least 2) whose halfway tick is a whole number. Same as the web app. */
fun niceMaxEven(v: Int): Int {
    if (v <= 2) return 2
    val p = 10.0.pow(floor(log10(v.toDouble())))
    val step = listOf(1, 2, 4, 5, 6, 8, 10).first { v <= it * p && ((it * p) / 2) % 1.0 == 0.0 }
    return (step * p).roundToInt()
}

private fun compact(v: Int): String = when {
    v >= 1_000_000 -> "${(v / 100_000) / 10.0}".removeSuffix(".0") + "M"
    v >= 10_000 -> "${v / 1000}k"
    v >= 1000 -> "${(v / 100) / 10.0}".removeSuffix(".0") + "k"
    else -> "$v"
}

/**
 * Multi-series line chart on one y-axis, like the web app's: 2dp lines, a ringed dot at the current day,
 * names at the line ends when they don't collide, three recessive gridlines. Touch and drag to move the
 * crosshair; [onSelect] reports the day under the finger (null when released) so the legend can show its values.
 */
@Composable
fun LineChart(
    series: List<ChartSeries>,
    xLabel: (Int) -> String,
    selected: Int?,
    onSelect: (Int?) -> Unit,
    description: String,
    modifier: Modifier = Modifier,
    height: Dp = 140.dp,
    ring: Color = MaterialTheme.colorScheme.background,
) {
    val n = series.firstOrNull()?.values?.size ?: 0
    if (n == 0) return
    val measurer = rememberTextMeasurer()
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val axis = MaterialTheme.colorScheme.outline
    val grid = axis.copy(alpha = 0.55f)
    val cross = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f)
    val small = TextStyle(fontSize = 11.sp, color = muted, fontFamily = MaterialTheme.typography.bodySmall.fontFamily)
    val max = niceMaxEven(series.maxOf { s -> s.values.maxOrNull() ?: 0 })
    val ticks = listOf(0, max / 2, max)
    val plot = remember { floatArrayOf(0f, 1f) } // x of the first and last day, for touch → day (set while drawing)
    val select by rememberUpdatedState(onSelect)
    Canvas(
        modifier
            .fillMaxWidth()
            .height(height)
            .semantics { contentDescription = description }
            .pointerInput(n) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    fun pick(x: Float) {
                        val (l, r) = plot
                        select(if (n == 1) 0 else (((x - l) / (r - l)) * (n - 1)).roundToInt().coerceIn(0, n - 1))
                    }
                    pick(down.position.x)
                    while (true) {
                        // Final pass: if the list started scrolling vertically, it has consumed the move; let it go
                        val ev = awaitPointerEvent(PointerEventPass.Final)
                        val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                        if (!ch.pressed || ch.isConsumed) break
                        pick(ch.position.x)
                    }
                    select(null)
                }
            },
    ) {
        val top = 8.dp.toPx()
        val bottom = size.height - 22.dp.toPx()
        fun y(v: Int) = top + (bottom - top) * (1f - v.toFloat() / max)
        val labels = ticks.map { measurer.measure(compact(it), small) }
        val left = labels.maxOf { it.size.width } + 8.dp.toPx()
        // names at the line ends, unless two would overlap (the legend carries identity then)
        val ends = series.map { it to y(it.values.last()) }.sortedBy { it.second }
        val names = series.associateWith { measurer.measure(it.label, small) }
        val endLabels = size.width >= 300.dp.toPx() && ends.zipWithNext().all { (a, b) -> b.second - a.second >= 13.dp.toPx() }
        val right = if (endLabels) names.values.maxOf { it.size.width } + 14.dp.toPx() else 8.dp.toPx()
        val plotW = (size.width - left - right).coerceAtLeast(1f)
        fun x(i: Int) = left + if (n > 1) plotW * i / (n - 1) else plotW
        plot[0] = x(0); plot[1] = x(n - 1)

        ticks.forEachIndexed { k, t ->
            drawLine(if (t == 0) axis else grid, Offset(left, y(t)), Offset(size.width - right, y(t)), 1.dp.toPx())
            val l = labels[k]
            drawText(l, topLeft = Offset(left - 8.dp.toPx() - l.size.width, y(t) - l.size.height / 2f))
        }
        val xTicks = if (n > 1) listOf(0, (n - 1) / 2, n - 1) else listOf(0)
        xTicks.forEachIndexed { k, i ->
            val l = measurer.measure(xLabel(i), small)
            val lx = when (k) { 0 -> x(i); xTicks.lastIndex -> x(i) - l.size.width; else -> x(i) - l.size.width / 2f }
            drawText(l, topLeft = Offset(lx, size.height - l.size.height))
        }
        selected?.let { drawLine(cross, Offset(x(it), top), Offset(x(it), bottom), 1.dp.toPx()) }
        series.forEach { s ->
            val path = Path()
            s.values.forEachIndexed { i, v -> if (i == 0) path.moveTo(x(i), y(v)) else path.lineTo(x(i), y(v)) }
            drawPath(path, s.color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
        val at = selected ?: (n - 1)
        series.forEach { s ->
            val c = Offset(x(at), y(s.values[at]))
            drawCircle(ring, 6.dp.toPx(), c)
            drawCircle(s.color, 4.dp.toPx(), c)
        }
        if (endLabels) ends.forEach { (s, ey) ->
            val l = names.getValue(s)
            drawText(l, topLeft = Offset(x(n - 1) + 10.dp.toPx(), ey - l.size.height / 2f))
        }
    }
}

private val TREND_LABELS = listOf("Learning", "Young", "Mature")

/**
 * How many cards are learning, young and mature each day (new cards left out), like the web app's Decks page.
 * The legend shows today's numbers, or the touched day's. Hidden until something has been studied.
 */
@Composable
fun CardTrend(trend: List<TrendDay>, modifier: Modifier = Modifier, chartHeight: Dp = 140.dp, ring: Color = MaterialTheme.colorScheme.background) {
    val first = trend.indexOfFirst { it.learning + it.young + it.mature > 0 }
    if (first < 0) return
    // start just before the first studied card, but show at least two weeks
    val days = trend.drop(maxOf(0, minOf(first - 1, trend.size - 14)))
    val colors = if (LocalDark.current) SeriesDark else SeriesLight
    val series = listOf(
        ChartSeries(TREND_LABELS[0], colors[0], days.map { it.learning }),
        ChartSeries(TREND_LABELS[1], colors[1], days.map { it.young }),
        ChartSeries(TREND_LABELS[2], colors[2], days.map { it.mature }),
    )
    var selected by remember { mutableStateOf<Int?>(null) }
    var table by remember { mutableStateOf(false) }
    val fmt = remember { NumberFormat.getIntegerInstance() }
    val dateFmt = remember { DateTimeFormatter.ofPattern("MMM d") }
    fun label(i: Int) = if (i == days.lastIndex) "Today" else try { LocalDate.parse(days[i].date).format(dateFmt) } catch (_: Exception) { days[i].date }
    val at = selected ?: days.lastIndex
    Column(modifier) {
        // fixed height: the date that replaces the table button while touching mustn't move the chart
        Row(Modifier.height(32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            series.forEach { s ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(12.dp).height(2.dp).background(s.color, RoundedCornerShape(1.dp)))
                    Text(s.label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 6.dp, end = 5.dp))
                    Text(fmt.format(s.values[at]), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            Box(Modifier.weight(1f))
            if (selected != null) Text(label(at), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else IconButton(onClick = { table = !table }, modifier = Modifier.size(32.dp)) {
                Icon(if (table) Icons.AutoMirrored.Filled.ShowChart else Icons.Default.TableChart, if (table) "Show chart" else "Show data as table", Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (table) {
            Column(
                Modifier.padding(top = 6.dp).fillMaxWidth().heightIn(max = 224.dp)
                    .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
                    .verticalScroll(rememberScrollState()),
            ) {
                Row(Modifier.background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 12.dp, vertical = 6.dp)) {
                    Text("Day", Modifier.weight(1f), fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    TREND_LABELS.forEach { Text(it, Modifier.weight(1f), fontSize = 12.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.End) }
                }
                days.indices.reversed().forEach { i ->
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
                        Text(label(i), Modifier.weight(1f), fontSize = 12.sp)
                        series.forEach { s -> Text(fmt.format(s.values[i]), Modifier.weight(1f), fontSize = 12.sp, textAlign = TextAlign.End) }
                    }
                }
            }
        } else {
            val last = days.last()
            LineChart(
                series, ::label, selected, { selected = it },
                description = "Cards by state over the last ${days.size} days. Today: ${last.learning} learning, ${last.young} young, ${last.mature} mature.",
                modifier = Modifier.padding(top = 6.dp),
                height = chartHeight,
                ring = ring,
            )
        }
    }
}
