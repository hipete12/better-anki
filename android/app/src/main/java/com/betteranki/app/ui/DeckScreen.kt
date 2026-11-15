package com.betteranki.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.fromHtml
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.betteranki.app.AppState
import com.betteranki.app.Screen
import com.betteranki.app.data.Counts
import com.betteranki.app.data.DeckOverview
import com.betteranki.app.data.DeckTotals
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * A deck's page, laid out like the web app's: title, today's counts with Study now, this deck's card trend,
 * then actions, the cards by maturity and the deck's description.
 */
@Composable
fun DeckOverviewScreen(app: AppState, id: Long) {
    var data by remember { mutableStateOf<DeckOverview?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf<DeckNaming?>(null) }
    var deleting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load() { try { data = app.api.get("/api/decks/$id"); error = null } catch (e: Exception) { error = e.message } }
    fun act(f: suspend () -> Unit) = scope.launch { try { f(); load() } catch (e: Exception) { error = e.message } }
    LaunchedEffect(id, app.changeTick, app.online) { load() }
    val offlineOnly = data == null && error != null && !app.online && app.offline.isAvailable(id)
    val d = data
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { app.pop() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Decks", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (d != null) Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "Deck actions") }
                DropdownMenu(menu, { menu = false }) {
                    @Composable fun item(label: String, icon: ImageVector, danger: Boolean = false, onClick: () -> Unit) = DropdownMenuItem(
                        text = { Text(label, color = if (danger) MaterialTheme.colorScheme.error else Color.Unspecified) },
                        leadingIcon = { Icon(icon, null, Modifier.size(20.dp), tint = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) },
                        onClick = { menu = false; onClick() },
                    )
                    if (d.deck.kind == 0) item("Add subdeck", Icons.Default.CreateNewFolder) { naming = DeckNaming.Create(d.deck.name) }
                    item("Rename", Icons.Default.Edit) { naming = DeckNaming.Rename(d.deck.id, d.deck.name) }
                    HorizontalDivider(Modifier.padding(vertical = 4.dp))
                    item("Delete", Icons.Default.Delete, danger = true) { deleting = true }
                }
            }
        }
        if (offlineOnly) return@Column OfflineDeck(app, id)
        error?.let { ErrorBox(it, Modifier.padding(16.dp)) }
        if (d == null) return@Column Loading()
        val parts = d.deck.name.split("::")
        val due = d.counts.new + d.counts.learn + d.counts.review
        Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(start = 20.dp, end = 20.dp, bottom = 32.dp)) {
            DeckTitle(parts, filtered = d.deck.kind == 1, subtitle = listOfNotNull(d.totals?.let { "${"%,d".format(it.total)} card${if (it.total == 1) "" else "s"}" }, d.configName?.let { "$it preset" }).joinToString(" · "))
            DeckCounts(d.counts)
            if (due > 0) StudyButton("Study now") { app.push(Screen.Study(id)) }
            else Text("Nothing due right now.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 15.sp)
            d.limits?.let { Text("${it.newLeft} new and ${it.revLeft} reviews left today", fontSize = 12.sp, color = appColors.faint, modifier = Modifier.padding(top = 10.dp)) }
            CardTrend(d.trend, Modifier.padding(top = 24.dp), chartHeight = 128.dp)
            DeckActions(d, onAdd = { app.push(Screen.Home(1, deckId = id)) }, onBrowse = { app.push(Screen.Home(2, query = deckQuery(d.deck.name))) }, act = ::act, app = app)
            if (d.deck.kind == 0) DeckOfflineRow(app, id) { error = it }
            d.totals?.let { Maturity(it) }
            if (d.deck.description.isNotBlank()) {
                Section("About this deck")
                Text(
                    AnnotatedString.fromHtml(d.deck.description, linkStyles = TextLinkStyles(SpanStyle(color = appColors.brand, textDecoration = TextDecoration.Underline))),
                    fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text("Deck options, custom study and export are in the web app.", fontSize = 12.sp, color = appColors.faint, modifier = Modifier.padding(top = 28.dp))
        }
    }
    naming?.let { n ->
        DeckNameDialog(n, onDismiss = { naming = null }) { name ->
            naming = null
            act {
                when (n) {
                    is DeckNaming.Create -> app.api.post<JsonObject>("/api/decks", buildJsonObject { put("name", name) }).also { app.notice = "Created ${name.substringAfterLast("::")}" }
                    is DeckNaming.Rename -> app.api.request("PATCH", "/api/decks/${n.id}", buildJsonObject { put("name", name) }, JsonObject.serializer())
                }
            }
        }
    }
    if (deleting && d != null) {
        val total = d.totals?.total ?: 0
        AlertDialog(
            onDismissRequest = { deleting = false },
            title = { Text("Delete “${d.deck.name.substringAfterLast("::")}”?") },
            text = { Text(if (total == 0) "This deck is empty." else "This deletes the deck, its subdecks and $total card${if (total == 1) "" else "s"}. The server keeps backups.") },
            confirmButton = {
                TextButton(onClick = {
                    deleting = false
                    scope.launch { try { app.api.delete<JsonObject>("/api/decks/$id"); app.notice = "Deleted ${d.deck.name.substringAfterLast("::")}"; app.pop() } catch (e: Exception) { error = e.message } }
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun DeckTitle(parts: List<String>, filtered: Boolean, subtitle: String) {
    if (parts.size > 1) Text(parts.dropLast(1).joinToString(" / "), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(parts.last(), style = MaterialTheme.typography.headlineMedium, modifier = Modifier.weight(1f, fill = false))
        if (filtered) Surface(Modifier.padding(start = 10.dp), shape = RoundedCornerShape(6.dp), color = appColors.brand.copy(alpha = 0.12f)) {
            Text("Filtered", Modifier.padding(horizontal = 7.dp, vertical = 2.dp), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = appColors.brand)
        }
    }
    if (subtitle.isNotEmpty()) Text(subtitle, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
}

@Composable
private fun DeckCounts(c: Counts) {
    val ac = appColors
    Row(Modifier.padding(top = 24.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(36.dp)) {
        Stat("${c.new}", "New", color = if (c.new > 0) ac.new else ac.faint, large = true)
        Stat("${c.learn}", "Learning", color = if (c.learn > 0) ac.learn else ac.faint, large = true)
        Stat("${c.review}", "To review", color = if (c.review > 0) ac.due else ac.faint, large = true)
    }
}

@Composable
private fun StudyButton(label: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(50.dp),
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(containerColor = BrandDark, contentColor = Color.White),
    ) {
        Icon(Icons.Default.PlayArrow, null, Modifier.size(20.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DeckActions(d: DeckOverview, onAdd: () -> Unit, onBrowse: () -> Unit, act: (suspend () -> Unit) -> Unit, app: AppState) {
    FlowRow(Modifier.padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        @Composable fun btn(label: String, icon: ImageVector, onClick: () -> Unit) = OutlinedButton(
            onClick = onClick, shape = RoundedCornerShape(8.dp), contentPadding = PaddingValues(start = 10.dp, end = 12.dp), modifier = Modifier.height(36.dp),
        ) {
            Icon(icon, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(6.dp))
            Text(label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
        }
        if (d.deck.kind == 0) btn("Add cards", Icons.Default.Add, onAdd)
        else {
            btn("Rebuild", Icons.Default.Refresh) { act { app.api.post<JsonObject>("/api/decks/${d.deck.id}/rebuild") } }
            btn("Empty", Icons.Default.Delete) { act { app.api.post<JsonObject>("/api/decks/${d.deck.id}/empty") } }
        }
        btn("Browse", Icons.Default.Search, onBrowse)
        if (d.buried > 0) btn("Unbury ${d.buried}", Icons.Default.Visibility) { act { app.api.post<JsonObject>("/api/decks/${d.deck.id}/unbury") } }
    }
}

@Composable
private fun Section(title: String, trailing: String? = null) {
    HorizontalDivider(Modifier.padding(top = 28.dp, bottom = 18.dp), color = MaterialTheme.colorScheme.outline)
    Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.Bottom) {
        Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        trailing?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

/** The deck's cards by maturity: one segmented bar (2dp gaps between segments) and a legend with the counts. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Maturity(t: DeckTotals) {
    val dark = LocalDark.current
    val ac = appColors
    val segs = listOf(
        Triple("New", t.new, ac.new),
        Triple("Learning", t.learning, ac.learn),
        Triple("Young", t.young, if (dark) Color(0xFF16A34A) else Color(0xFF4ADE80)),
        Triple("Mature", t.mature, if (dark) Color(0xFF4ADE80) else Color(0xFF15803D)),
        Triple("Suspended", t.suspended, Color(0xFFFBBF24)),
        Triple("Buried", t.buried, Color(0xFFA1A1AA)),
    )
    val active = t.total - t.suspended - t.buried
    Section("Cards", if (active > 0) "${(100 * t.mature + active / 2) / active}% mature" else null)
    val shown = segs.filter { it.second > 0 }
    Row(Modifier.fillMaxWidth().height(10.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        if (shown.isEmpty()) Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp)))
        shown.forEach { (_, n, c) -> Box(Modifier.weight(n.toFloat()).fillMaxSize().background(c, RoundedCornerShape(3.dp))) }
    }
    FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        segs.forEach { (label, n, c) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).background(c, RoundedCornerShape(2.dp)))
                Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 6.dp, end = 4.dp))
                Text("%,d".format(n), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** No server: the deck from the downloaded copy. */
@Composable
private fun OfflineDeck(app: AppState, id: Long) {
    val e = app.offline.engine!!
    @Suppress("UNUSED_VARIABLE") val v = app.offline.version
    val c = e.counts(id, System.currentTimeMillis() / 1000)
    Column(Modifier.padding(horizontal = 20.dp)) {
        DeckTitle((e.deck(id)?.name ?: "").split("::"), filtered = false, subtitle = "Offline · from your downloaded copy")
        DeckCounts(Counts(c.new, c.learn, c.review))
        StudyButton("Study offline") { app.push(Screen.Study(id, offline = true)) }
    }
}
