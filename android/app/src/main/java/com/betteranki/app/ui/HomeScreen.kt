package com.betteranki.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FilterAlt
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.foundation.combinedClickable
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.ui.focus.focusRequester
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.betteranki.app.AppState
import com.betteranki.app.Screen
import com.betteranki.app.data.AppConfig
import com.betteranki.app.data.BrowseResult
import com.betteranki.app.data.DeckNode
import com.betteranki.app.data.DeckTree
import com.betteranki.app.data.SessionInfo
import com.betteranki.app.data.Stats
import com.betteranki.app.data.TransportPolicy
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.text.DateFormat
import java.util.Date

private data class Tab(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)
private val TABS = listOf(Tab("Decks", Icons.Default.Layers), Tab("Add", Icons.Default.Add), Tab("Browse", Icons.Default.Search), Tab("Stats", Icons.Default.BarChart), Tab("Settings", Icons.Default.Settings))

@Composable
fun HomeScreen(app: AppState, home: Screen.Home) {
    val tab = home.tab
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
                TABS.forEachIndexed { i, t ->
                    NavigationBarItem(
                        selected = tab == i,
                        onClick = { if (i != tab) app.replaceTop(Screen.Home(i)) },
                        icon = { Icon(t.icon, t.label) },
                        label = { Text(t.label, fontSize = 11.sp) },
                        colors = NavigationBarItemDefaults.colors(selectedIconColor = Brand, selectedTextColor = Brand, indicatorColor = Brand.copy(alpha = 0.12f)),
                    )
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (tab) {
                0 -> DecksTab(app)
                1 -> AddNoteTab(app, home.deckId)
                2 -> BrowseTab(app, home.query)
                3 -> StatsTab(app)
                else -> SettingsTab(app)
            }
        }
    }
}

@Composable
fun TabHeader(title: String, subtitle: String? = null, start: androidx.compose.ui.unit.Dp = 20.dp, actions: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(start = start, end = 12.dp, top = 20.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineMedium)
            subtitle?.let { Text(it, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        actions()
    }
}

// ---------------- Decks ----------------
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DecksTab(app: AppState) {
    var data by remember { mutableStateOf<DeckTree?>(null) }
    var home by remember { mutableStateOf<com.betteranki.app.data.HomeSummary?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf<DeckNaming?>(null) }
    var deleting by remember { mutableStateOf<DeckNode?>(null) }
    val collapsed = remember { mutableStateOf(setOf<Long>()) }
    val scope = rememberCoroutineScope()
    suspend fun load() {
        try {
            data = app.api.get<DeckTree>("/api/decks")
            collapsed.value = flatten(data!!.tree).filter { it.collapsed }.map { it.id }.toSet()
            home = app.api.get<com.betteranki.app.data.HomeSummary>("/api/home")
            error = null
        } catch (e: Exception) {
            error = e.message
        }
    }
    fun act(f: suspend () -> Unit) = scope.launch { try { f(); load() } catch (e: Exception) { app.notice = e.message } }
    LaunchedEffect(app.changeTick) { load() }
    PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }) {
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                TabHeader("Decks") {
                    IconButton(onClick = { naming = DeckNaming.Create() }) { Icon(Icons.Default.Add, "Create deck") }
                }
            }
            // cards per state over time (new cards left out), like the web app
            home?.let { h -> item { CardTrend(h.trend, Modifier.padding(start = 20.dp, end = 16.dp, bottom = 20.dp), chartHeight = 132.dp) } }
            item { OfflineBanner(app, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) }
            if (error != null && !app.online && app.offline.engine != null) {
                item { OfflineDecks(app, Modifier.padding(horizontal = 16.dp)) }
            } else error?.let { item { ErrorBox(it, Modifier.padding(16.dp)) } }
            if (data == null && error == null) item { Box(Modifier.height(300.dp)) { Loading() } }
            data?.let { d ->
                item {
                    Panel(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
                        Column {
                            val rows = visible(d.tree, collapsed.value)
                            if (rows.isEmpty()) Text("No decks yet. Import an .apkg from the web app or create a deck.", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            else DeckHeader()
                            rows.forEach { (node, depth) ->
                                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                                DeckRow(
                                    node, depth, node.id in collapsed.value,
                                    onToggle = {
                                        val c = collapsed.value
                                        collapsed.value = if (node.id in c) c - node.id else c + node.id
                                        scope.launch { try { app.api.request("PATCH", "/api/decks/${node.id}", buildJsonObject { put("collapsed", node.id in collapsed.value) }, JsonObject.serializer()) } catch (_: Exception) {} }
                                    },
                                    onClick = { app.push(Screen.Deck(node.id)) },
                                    menu = deckMenu(app, node, onRename = { naming = DeckNaming.Rename(node.id, node.name) }, onSubdeck = { naming = DeckNaming.Create(node.name) }, onDelete = { deleting = node }),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
    naming?.let { n ->
        DeckNameDialog(n, onDismiss = { naming = null }) { name ->
            naming = null
            act {
                when (n) {
                    is DeckNaming.Create -> app.api.post<JsonObject>("/api/decks", buildJsonObject { put("name", name) })
                    is DeckNaming.Rename -> app.api.request("PATCH", "/api/decks/${n.id}", buildJsonObject { put("name", name) }, JsonObject.serializer())
                }
            }
        }
    }
    deleting?.let { node ->
        val sub = flatten(node.children).size
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete “${node.shortName}”?") },
            text = { Text(if (node.total == 0 && sub == 0) "This deck is empty." else "This deletes ${node.total} card${if (node.total == 1) "" else "s"}" + (if (sub > 0) " and $sub subdeck${if (sub == 1) "" else "s"}" else "") + ". It can't be undone here, but the server keeps backups.") },
            confirmButton = { TextButton(onClick = { deleting = null; act { app.api.delete<JsonObject>("/api/decks/${node.id}"); app.notice = "Deleted ${node.shortName}" } }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

sealed class DeckNaming {
    /** `parent`: create a subdeck under it. */
    data class Create(val parent: String? = null) : DeckNaming()
    data class Rename(val id: Long, val name: String) : DeckNaming()
}

@Composable
fun DeckNameDialog(n: DeckNaming, onDismiss: () -> Unit, onDone: (String) -> Unit) {
    val initial = when (n) { is DeckNaming.Create -> n.parent?.let { "$it::" } ?: ""; is DeckNaming.Rename -> n.name }
    var name by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(initial, androidx.compose.ui.text.TextRange(initial.length))) }
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val ok = name.text.split("::").all { it.isNotBlank() } && name.text.trim() != (n as? DeckNaming.Rename)?.name
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(when (n) { is DeckNaming.Create -> if (n.parent != null) "New subdeck" else "New deck"; is DeckNaming.Rename -> "Rename deck" }) },
        text = {
            OutlinedTextField(
                name, { name = it }, label = { Text("Name (use :: for subdecks)") }, singleLine = true,
                modifier = Modifier.focusRequester(focus),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done, capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { if (ok) onDone(name.text.trim()) }),
            )
        },
        confirmButton = { TextButton(enabled = ok, onClick = { onDone(name.text.trim()) }) { Text(if (n is DeckNaming.Rename) "Rename" else "Create") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

private class MenuItem(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val enabled: Boolean = true, val danger: Boolean = false, val onClick: () -> Unit)

/** The deck's actions (long-press a deck), like the web app's pencil menu. */
private fun deckMenu(app: AppState, node: DeckNode, onRename: () -> Unit, onSubdeck: () -> Unit, onDelete: () -> Unit): List<MenuItem?> {
    val due = node.counts.new + node.counts.learn + node.counts.review
    return listOfNotNull(
        MenuItem("Study now", Icons.Default.PlayArrow, enabled = due > 0) { app.push(Screen.Study(node.id)) },
        if (node.kind == 0) MenuItem("Add cards", Icons.Default.Add) { app.push(Screen.Home(1, deckId = node.id)) } else null,
        MenuItem("Browse cards", Icons.Default.Search) { app.push(Screen.Home(2, query = deckQuery(node.name))) },
        if (node.kind == 0) MenuItem("Add subdeck", Icons.Default.CreateNewFolder, onClick = onSubdeck) else null,
        MenuItem("Rename", Icons.Default.Edit, onClick = onRename),
        null, // divider
        MenuItem("Delete", Icons.Default.Delete, danger = true, onClick = onDelete),
    )
}

/** `key:"value"` with search wildcards and quotes escaped, so names with `*`, `_` or quotes match exactly. */
fun searchTerm(key: String, value: String) = "$key:\"" + value.replace(Regex("[\\\\\"*_]")) { "\\" + it.value } + "\""
fun deckQuery(name: String) = searchTerm("deck", name)

private fun flatten(nodes: List<DeckNode>): List<DeckNode> = nodes.flatMap { listOf(it) + flatten(it.children) }
private fun visible(nodes: List<DeckNode>, collapsed: Set<Long>, depth: Int = 0): List<Pair<DeckNode, Int>> =
    nodes.flatMap { n -> listOf(n to depth) + if (n.id in collapsed) emptyList() else visible(n.children, collapsed, depth + 1) }

private val CHEVRON = 30.dp
private val COUNT_W = 46.dp

/** Column names, lined up with the deck names and the counts under them (like the web app's table header). */
@Composable
private fun DeckHeader() {
    Row(Modifier.fillMaxWidth().padding(start = 6.dp + CHEVRON, end = 12.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        val st = Modifier
        Text("Deck", st.weight(1f), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        listOf("New", "Learn", "Due").forEach { Text(it, Modifier.width(COUNT_W), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.End) }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun DeckRow(node: DeckNode, depth: Int, collapsed: Boolean, onToggle: () -> Unit, onClick: () -> Unit, menu: List<MenuItem?>) {
    var open by remember { mutableStateOf(false) }
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    Box {
        Row(
            Modifier.fillMaxWidth()
                .combinedClickable(onClick = onClick, onLongClick = { haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress); open = true }, onLongClickLabel = "Deck actions")
                .padding(start = (6 + depth * 16).dp, end = 12.dp).height(48.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(CHEVRON, 40.dp).clickable(enabled = node.children.isNotEmpty(), onClick = onToggle, onClickLabel = if (collapsed) "Expand" else "Collapse"), contentAlignment = Alignment.Center) {
                if (node.children.isNotEmpty()) Icon(if (collapsed) Icons.Default.ChevronRight else Icons.Default.ExpandMore, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Text(node.shortName, Modifier.weight(1f, fill = false), fontWeight = if (depth == 0) FontWeight.Medium else FontWeight.Normal, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, fontStyle = if (node.kind == 1) FontStyle.Italic else FontStyle.Normal)
                Text(if (node.kind == 1) "filtered" else "${node.total}", Modifier.padding(start = 6.dp), fontSize = 12.sp, color = if (node.kind == 1) appColors.brand else appColors.faint, maxLines = 1)
            }
            val ac = appColors
            listOf(node.counts.new to ac.new, node.counts.learn to ac.learn, node.counts.review to ac.due).forEach { (n, c) ->
                Text("$n", Modifier.width(COUNT_W), color = if (n > 0) c else ac.faint, fontWeight = if (n > 0) FontWeight.SemiBold else FontWeight.Normal, fontSize = 14.sp, textAlign = androidx.compose.ui.text.style.TextAlign.End)
            }
        }
        DropdownMenu(open, { open = false }, offset = androidx.compose.ui.unit.DpOffset((40 + depth * 16).dp, (-8).dp)) {
            menu.forEach { m ->
                if (m == null) HorizontalDivider(Modifier.padding(vertical = 4.dp))
                else DropdownMenuItem(
                    text = { Text(m.label, color = if (m.danger) MaterialTheme.colorScheme.error else Color.Unspecified) },
                    leadingIcon = { Icon(m.icon, null, Modifier.size(20.dp), tint = if (m.danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) },
                    enabled = m.enabled,
                    onClick = { open = false; m.onClick() },
                )
            }
        }
    }
}

// ---------------- Stats ----------------
@Composable
fun StatsTab(app: AppState) {
    var stats by remember { mutableStateOf<Stats?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(app.changeTick) {
        try { stats = app.api.get<Stats>("/api/stats?days=30"); error = null } catch (e: Exception) { error = e.message }
    }
    val dark = LocalDark.current
    val series = if (dark) SeriesDark else SeriesLight
    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
        item { TabHeader("Statistics", "Whole collection · last 30 days") }
        error?.let { item { ErrorBox(it, Modifier.padding(16.dp)) } }
        val s = stats
        if (s == null) item { Box(Modifier.height(300.dp)) { Loading() } }
        else {
            item {
                val ac = appColors
                Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Stat("${s.today.cards}", "studied today · ${fmtDuration(s.today.timeMs)}", Modifier.weight(1f), if (s.today.cards > 0) ac.brand else ac.faint)
                        Stat("${s.dueTomorrow}", if (s.overdue > 0) "due tomorrow · ${s.overdue} overdue" else "due tomorrow", Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Stat("${s.streak}d", "streak · best ${s.longestStreak}d", Modifier.weight(1f), if (s.streak > 0) ac.streak else ac.faint)
                        Stat(if (s.fsrs) s.avgRetention?.let { String.format("%.1f%%", it) } ?: "–" else String.format("%.1f", s.summary.avgPerDay), if (s.fsrs) "avg. retrievability" else "reviews per day", Modifier.weight(1f), ac.due)
                    }
                }
            }
            item {
                Panel(Modifier.padding(16.dp).fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Calendar", fontWeight = FontWeight.SemiBold)
                        Text("Reviews per day, last 16 weeks", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(10.dp))
                        val days = s.heatmap.takeLast(16 * 7)
                        val max = (days.maxOfOrNull { it.count } ?: 1).coerceAtLeast(1)
                        val levels = if (dark) listOf(Color(0xFF1F2330), Color(0xFF184F95), Color(0xFF256ABF), Color(0xFF3987E5), Color(0xFF86B6EF)) else listOf(Color(0xFFEEF1F6), Color(0xFFB7D3F6), Color(0xFF6DA7EC), Color(0xFF2A78D6), Color(0xFF184F95))
                        Canvas(Modifier.fillMaxWidth().height(120.dp)) {
                            val weeks = 16
                            val gap = 3.dp.toPx()
                            val cell = minOf((size.width - gap * (weeks - 1)) / weeks, (size.height - gap * 6) / 7)
                            days.forEachIndexed { i, d ->
                                val lvl = if (d.count == 0) 0 else minOf(4, 1 + (d.count * 4 / (max + 1)))
                                drawRoundRect(levels[lvl], topLeft = Offset((i / 7) * (cell + gap), (i % 7) * (cell + gap)), size = Size(cell, cell), cornerRadius = CornerRadius(3.dp.toPx()))
                            }
                        }
                    }
                }
            }
            item {
                Panel(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Future due", fontWeight = FontWeight.SemiBold)
                        Text("Next 30 days", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            listOf("Learning", "Young", "Mature").forEachIndexed { i, l ->
                                Row(verticalAlignment = Alignment.CenterVertically) { Dot(series[i]); Text(" $l", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                        val f = s.forecast.take(31)
                        val max = (f.maxOfOrNull { it.learn + it.young + it.mature } ?: 1).coerceAtLeast(1)
                        val grid = MaterialTheme.colorScheme.outline
                        Canvas(Modifier.fillMaxWidth().height(140.dp)) {
                            val band = size.width / f.size
                            val bw = minOf(band - 2.dp.toPx(), 24.dp.toPx())
                            drawLine(grid, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
                            f.forEachIndexed { i, d ->
                                var y = size.height
                                listOf(d.learn, d.young, d.mature).forEachIndexed { si, v ->
                                    if (v > 0) {
                                        val h = v.toFloat() / max * (size.height - 4.dp.toPx())
                                        drawRoundRect(series[si], topLeft = Offset(i * band + (band - bw) / 2, y - h), size = Size(bw, (h - 2.dp.toPx()).coerceAtLeast(1f)), cornerRadius = CornerRadius(3.dp.toPx()))
                                        y -= h
                                    }
                                }
                            }
                        }
                        Row(Modifier.fillMaxWidth()) {
                            Text("Today", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                            Text("+30d", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            item {
                Panel(Modifier.padding(16.dp).fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("True retention", fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(8.dp))
                        Row { listOf("Period" to 2f, "Young" to 1f, "Mature" to 1f, "Total" to 1f).forEach { (h, w) -> Text(h, Modifier.weight(w), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
                        s.retention.forEach { r ->
                            HorizontalDivider(Modifier.padding(vertical = 6.dp), color = MaterialTheme.colorScheme.outline)
                            Row {
                                Text(r.label, Modifier.weight(2f), fontSize = 13.sp)
                                listOf(r.young, r.mature, r.total).forEach { v -> Text(v?.let { String.format("%.0f%%", it) } ?: "–", Modifier.weight(1f), fontSize = 13.sp) }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------- Settings ----------------
@Composable
fun SettingsTab(app: AppState) {
    var confirmSignOut by remember { mutableStateOf(false) }
    var cfg by remember { mutableStateOf<AppConfig?>(null) }
    var sessions by remember { mutableStateOf<List<SessionInfo>>(emptyList()) }
    var allDevices by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun load() {
        try {
            cfg = app.api.get<AppConfig>("/api/config")
            sessions = app.api.get<List<SessionInfo>>("/api/auth/sessions")
        } catch (e: Exception) { error = e.message }
    }
    LaunchedEffect(Unit) { load() }
    val creds = app.creds
    val transport = TransportPolicy.check(creds?.server ?: "")
    LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { TabHeader("Settings", creds?.username?.let { "Signed in as $it" }, start = 4.dp) }
        error?.let { item { ErrorBox(it) } }
        item {
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Security & encryption", fontWeight = FontWeight.SemiBold)
                    SecurityLine(true, "At rest", "Collection, media, filenames and backups are AES-256-GCM encrypted on the server.")
                    SecurityLine(transport.secure, "In transit", transport.reason)
                    SecurityLine(true, "This device", "Session token encrypted with a non-exportable Android Keystore key; backups disabled.")
                    Text("Server: ${creds?.server}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item { AppearanceSettings() }
        item {
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Scheduling", fontWeight = FontWeight.SemiBold)
                    cfg?.let { c ->
                        SettingSwitch("FSRS scheduler", "Modern memory model; off = classic SM-2", c.fsrs) { v -> cfg = c.copy(fsrs = v); scope.launch { app.api.put<JsonObject>("/api/config", buildJsonObject { put("fsrs", v) }) } }
                        SettingSwitch("Load balancer", "Spread reviews evenly across days", c.loadBalancer) { v -> cfg = c.copy(loadBalancer = v); scope.launch { app.api.put<JsonObject>("/api/config", buildJsonObject { put("loadBalancer", v) }) } }
                        Text("Next day starts at ${c.rolloverHour}:00 · learn ahead ${c.learnAheadMins} min", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                    }
                }
            }
        }
        item { OfflineSettings(app) }
        item {
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Signed-in devices", fontWeight = FontWeight.SemiBold)
                    Text("Revoking a device destroys its key.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    val sorted = sessions.sortedWith(compareByDescending<SessionInfo> { it.current == true }.thenByDescending { it.lastSeen })
                    (if (allDevices) sorted else sorted.take(3)).forEach { s ->
                        Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(s.device + if (s.current == true) "  (this device)" else "", fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("Last active " + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(s.lastSeen)), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (s.current != true) TextButton(onClick = { scope.launch { try { app.api.delete<JsonObject>("/api/auth/sessions/${s.id}"); load() } catch (e: Exception) { error = e.message } } }) { Text("Revoke", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                    if (sorted.size > 3) TextButton(onClick = { allDevices = !allDevices }, contentPadding = PaddingValues(0.dp), modifier = Modifier.padding(top = 4.dp)) {
                        Text(if (allDevices) "Show fewer" else "Show all ${sorted.size} devices")
                    }
                }
            }
        }
        item {
            OutlinedButton(onClick = { if (app.offline.pending > 0) confirmSignOut = true else scope.launch { app.signOut() } }, modifier = Modifier.fillMaxWidth().height(48.dp), shape = RoundedCornerShape(10.dp)) {
                Text("Sign out")
            }
        }
    }
    if (confirmSignOut) AlertDialog(
        onDismissRequest = { confirmSignOut = false },
        title = { Text("Sign out?") },
        text = { Text("${app.offline.pending} offline action${if (app.offline.pending == 1) " hasn't" else "s haven't"} synced yet. Signing out removes offline data from this device, including ${if (app.offline.pending == 1) "it" else "them"}.") },
        confirmButton = { TextButton(onClick = { confirmSignOut = false; scope.launch { app.signOut() } }) { Text("Sign out", color = Color(0xFFDC2626)) } },
        dismissButton = { TextButton(onClick = { confirmSignOut = false }) { Text("Cancel") } },
    )
}

/** Theme and font for this device, like the web app's Appearance settings. */
@Composable
private fun AppearanceSettings() {
    val a = LocalAppearance.current
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text("Appearance", fontWeight = FontWeight.SemiBold)
            Text("Theme", fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 12.dp, bottom = 6.dp))
            Segmented(ThemeChoice.entries, a.theme, { Text(it.label, fontSize = 14.sp) }, a::updateTheme)
            Text("Font", fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 14.dp, bottom = 6.dp))
            Segmented(FontChoice.entries, a.font, { Text(it.label, fontSize = 14.sp, fontFamily = it.family) }, a::updateFont)
            Text("Used across the app on this device. Cards keep the fonts set in their note type.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

@Composable
private fun SecurityLine(ok: Boolean, title: String, text: String) {
    Row {
        Box(Modifier.padding(top = 7.dp)) { Dot(if (ok) appColors.due else Color(0xFFD97706), 6) }
        Text(
            androidx.compose.ui.text.buildAnnotatedString {
                pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface))
                append("$title: ")
                pop()
                append(text)
            },
            fontSize = 13.sp,
            lineHeight = 18.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 10.dp),
        )
    }
}

@Composable
private fun SettingSwitch(title: String, hint: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp)
            Text(hint, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(value, onChange, colors = SwitchDefaults.colors(checkedTrackColor = BrandDark))
    }
}
