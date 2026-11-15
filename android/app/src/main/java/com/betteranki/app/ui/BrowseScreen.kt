package com.betteranki.app.ui

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.automirrored.filled.DriveFileMove
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.automirrored.filled.Label
import androidx.compose.material.icons.automirrored.filled.LabelOff
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.ViewColumn
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.betteranki.app.AppState
import com.betteranki.app.Screen
import com.betteranki.app.data.BrowseResult
import com.betteranki.app.data.BrowseRow
import com.betteranki.app.data.Changed
import com.betteranki.app.data.DeckListItem
import com.betteranki.app.data.Duplicated
import com.betteranki.app.data.LayoutFamily
import com.betteranki.app.data.Notetype
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.net.URLEncoder

/** What a card row can show, like the web app's table columns. Toggled under "Show"; saved on this device. */
private val COLUMNS = listOf(
    "order" to "#  (deck order)", "state" to "State", "answer" to "Answer", "deck" to "Deck", "due" to "Due", "ivl" to "Interval", "ease" to "Ease",
    "reps" to "Reviews", "lapses" to "Lapses", "notetype" to "Note type", "template" to "Card type", "layout" to "Display order", "tags" to "Tags",
    "created" to "Created", "modified" to "Modified",
)
private val DEFAULT_SHOWN = setOf("order", "state", "answer", "deck", "due")
private val SORTS = listOf(
    "created" to "Created", "modified" to "Modified", "order" to "# (deck order)", "sortField" to "Card", "state" to "State", "due" to "Due", "ivl" to "Interval",
    "ease" to "Ease", "reps" to "Reviews", "lapses" to "Lapses", "deck" to "Deck", "notetype" to "Note type", "template" to "Card type", "layout" to "Display order",
)

/** Card states, in the order the State sort uses (new → … → leech), with the web app's dot colors. */
class CardStateStyle(val label: String, val light: Color, val dark: Color, val hollow: Boolean = false)
val CARD_STATES = linkedMapOf(
    "new" to CardStateStyle("New", NewBlue, Color(0xFF60A5FA)),
    "learning" to CardStateStyle("Learning", LearnRed, Color(0xFFF87171)),
    "review" to CardStateStyle("Review (not due yet)", DueGreen, Color(0xFF4ADE80), hollow = true),
    "due" to CardStateStyle("Due", DueGreen, Color(0xFF4ADE80)),
    "suspended" to CardStateStyle("Suspended", Color(0xFFEAB308), Color(0xFFFACC15)),
    "buried" to CardStateStyle("Buried", Color(0xFFA1A1AA), Color(0xFF71717A)),
    "marked" to CardStateStyle("Marked", Color(0xFF7C3AED), Color(0xFFA78BFA)),
    "leech" to CardStateStyle("Leech", Color(0xFFEA580C), Color(0xFFFB923C)),
)

@Composable
fun StateDot(state: String, size: Int = 10) {
    val st = CARD_STATES[state] ?: return
    val c = if (LocalDark.current) st.dark else st.light
    val m = Modifier.size(size.dp).semantics { contentDescription = st.label }
    Box(if (st.hollow) m.border(1.5.dp, c, CircleShape) else m.background(c, CircleShape))
}

/** Browse state that outlives the tab (opening a card and coming back keeps the search, sort, scroll and selection). */
class BrowseState {
    var input by mutableStateOf("deck:current")
    var query by mutableStateOf("deck:current")
        private set
    var sort by mutableStateOf("created")
        private set
    var desc by mutableStateOf(true)
        private set
    var shown by mutableStateOf(DEFAULT_SHOWN)
        private set
    val rows = mutableStateListOf<BrowseRow>()
    var total by mutableIntStateOf(0)
    var ids by mutableStateOf<List<Long>>(emptyList())
    var error by mutableStateOf<String?>(null)
    var loading by mutableStateOf(false)
    var selected by mutableStateOf<Set<Long>>(emptySet())
    val list = LazyListState()
    private var prefs: android.content.SharedPreferences? = null
    private var seq = 0

    fun init(ctx: Context) {
        if (prefs != null) return
        val p = ctx.getSharedPreferences("browse", Context.MODE_PRIVATE)
        prefs = p
        p.getString("sort", null)?.let { s -> if (SORTS.any { it.first == s }) sort = s }
        desc = p.getBoolean("desc", true)
        p.getStringSet("shown", null)?.let { shown = it.toSet() }
    }
    fun search(q: String) { input = q; query = q; selected = emptySet() }
    /** Forget results and selection (signing out). */
    fun clear() { rows.clear(); ids = emptyList(); total = 0; selected = emptySet(); search("deck:current") }
    fun sortBy(key: String) {
        if (key == sort) desc = !desc else { sort = key; desc = key in setOf("created", "modified", "reps", "lapses", "ivl", "ease") }
        prefs?.edit()?.putString("sort", sort)?.putBoolean("desc", desc)?.apply()
    }
    fun flipDirection() { desc = !desc; prefs?.edit()?.putBoolean("desc", desc)?.apply() }
    fun toggle(col: String, on: Boolean) { shown = if (on) shown + col else shown - col; prefs?.edit()?.putStringSet("shown", shown)?.apply() }

    private fun url(offset: Int, limit: Int) = "/api/browse?q=${URLEncoder.encode(query, "UTF-8")}&sort=$sort&desc=${if (desc) 1 else 0}&offset=$offset&limit=$limit"

    /** Reload from the top, keeping as many rows as are loaded now so the scroll position survives. */
    suspend fun reload(app: AppState) {
        val my = ++seq
        loading = true
        try {
            val r = app.api.get<BrowseResult>(url(0, rows.size.coerceIn(200, 500)))
            if (my != seq) return
            rows.clear(); rows.addAll(r.rows); total = r.total; ids = r.ids; error = null
            selected = selected.intersect(r.ids.toSet())
        } catch (e: Exception) {
            if (my == seq) error = e.message
        } finally {
            if (my == seq) loading = false
        }
    }
    suspend fun more(app: AppState) {
        if (loading || rows.size >= total) return
        val my = ++seq
        loading = true
        try {
            val r = app.api.get<BrowseResult>(url(rows.size, 200))
            if (my == seq) { val have = rows.map { it.id }.toSet(); rows.addAll(r.rows.filter { it.id !in have }) }
        } catch (_: Exception) {
        } finally {
            if (my == seq) loading = false
        }
    }
    /** Note ids of the selection (loading them when some selected cards aren't on screen yet). */
    suspend fun selectedNotes(app: AppState): List<Long> {
        val loaded = rows.filter { it.id in selected }
        if (loaded.size == selected.size) return loaded.map { it.nid }.distinct()
        val q = if (selected.size == ids.size) query else "cid:${selected.joinToString(",")}"
        return app.api.get<BrowseResult>("/api/browse?q=${URLEncoder.encode(q, "UTF-8")}&mode=notes&limit=1").ids
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun BrowseTab(app: AppState, initialQuery: String? = null) {
    val b = app.browse
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var filters by remember { mutableStateOf(false) }
    var columns by remember { mutableStateOf(false) }
    var sortMenu by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        b.init(ctx)
        // a search handed over by another screen (e.g. a deck's Browse button): use it once
        if (initialQuery != null) { b.search(initialQuery); app.replaceTop(Screen.Home(2)) }
    }
    LaunchedEffect(b.query, b.sort, b.desc, app.changeTick) { b.reload(app) }
    LaunchedEffect(b.list) {
        snapshotFlow { b.list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { if (it > b.rows.size - 30) b.more(app) }
    }
    val selecting = b.selected.isNotEmpty()
    BackHandler(enabled = selecting) { b.selected = emptySet() }
    LaunchedEffect(selecting) { if (selecting) focus.clearFocus() } // the keyboard would cover the actions
    Column(Modifier.fillMaxSize()) {
        if (selecting) SelectionHeader(b)
        else TabHeader("Browse", if (b.rows.isEmpty() && b.loading) null else "${"%,d".format(b.total)} card${if (b.total == 1) "" else "s"}")
        OutlinedTextField(
            b.input, { b.input = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp),
            leadingIcon = { Icon(Icons.Default.Search, null) },
            trailingIcon = { if (b.input.isNotEmpty()) IconButton(onClick = { b.input = "" }) { Icon(Icons.Default.Clear, "Clear search") } },
            placeholder = { Text("Search, e.g. dog deck:Spanish is:due", fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            shape = RoundedCornerShape(10.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onSearch = { b.search(b.input.trim()); focus.clearFocus() }),
        )
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ToolChip("Filters", Icons.Default.FilterList) { filters = true }
            Box {
                ToolChip(SORTS.firstOrNull { it.first == b.sort }?.second ?: "Sort", Icons.AutoMirrored.Filled.Sort, trailing = if (b.desc) Icons.Default.ArrowDownward else Icons.Default.ArrowUpward) { sortMenu = true }
                DropdownMenu(sortMenu, { sortMenu = false }) {
                    Text("Sort by", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                    SORTS.forEach { (k, label) ->
                        DropdownMenuItem(
                            text = { Text(label) },
                            trailingIcon = { if (k == b.sort) Icon(if (b.desc) Icons.Default.ArrowDownward else Icons.Default.ArrowUpward, if (b.desc) "Descending" else "Ascending", Modifier.size(18.dp)) },
                            leadingIcon = { Icon(Icons.Default.Check, null, Modifier.size(18.dp), tint = if (k == b.sort) appColors.brand else Color.Transparent) },
                            onClick = { sortMenu = false; b.sortBy(k) },
                        )
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { columns = true }) { Icon(Icons.Default.ViewColumn, "Choose what rows show", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Box(Modifier.fillMaxWidth().height(2.dp)) {
            if (b.loading) LinearProgressIndicator(Modifier.fillMaxSize(), color = Brand, trackColor = Color.Transparent)
        }
        b.error?.let { ErrorBox(it, Modifier.padding(16.dp)) }
        Box(Modifier.weight(1f)) {
            if (b.rows.isEmpty() && b.loading) Loading()
            else if (b.rows.isEmpty() && b.error == null) Text("No cards match this search.", Modifier.fillMaxWidth().padding(top = 48.dp), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else LazyColumn(state = b.list, contentPadding = PaddingValues(bottom = 24.dp)) {
                item { HorizontalDivider(color = MaterialTheme.colorScheme.outline) }
                items(b.rows, key = { it.id }) { r ->
                    val sel = r.id in b.selected
                    CardRow(r, b.shown, sel, selecting,
                        onClick = { if (selecting) b.selected = if (sel) b.selected - r.id else b.selected + r.id else app.push(Screen.EditNote(r.nid)) },
                        onLongClick = { b.selected = if (sel) b.selected - r.id else b.selected + r.id },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                }
            }
        }
        if (selecting) SelectionActions(app, b)
    }
    if (filters) FilterSheet(app, b.query, onDismiss = { filters = false }) { q -> filters = false; b.search(q); scope.launch { b.list.scrollToItem(0) } }
    if (columns) ColumnsSheet(b) { columns = false }
}

@Composable
private fun ToolChip(label: String, icon: ImageVector, trailing: ImageVector? = null, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, shape = RoundedCornerShape(8.dp), contentPadding = PaddingValues(start = 10.dp, end = 12.dp), modifier = Modifier.height(34.dp)) {
        Icon(icon, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(start = 6.dp))
        trailing?.let { Icon(it, null, Modifier.padding(start = 4.dp).size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun SelectionHeader(b: BrowseState) {
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { b.selected = emptySet() }) { Icon(Icons.Default.Close, "Clear selection") }
        Text("${"%,d".format(b.selected.size)} selected", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).padding(start = 4.dp))
        if (b.selected.size < b.ids.size) TextButton(onClick = { b.selected = b.ids.toSet() }) {
            Icon(Icons.Default.SelectAll, null, Modifier.size(18.dp)); Text("  All ${"%,d".format(b.ids.size)}")
        }
    }
}

private val ROW_LINE = 21.dp

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CardRow(r: BrowseRow, shown: Set<String>, selected: Boolean, selecting: Boolean, onClick: () -> Unit, onLongClick: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    val bg = when {
        selected -> appColors.brand.copy(alpha = 0.12f)
        r.queue == -1 -> Color(0xFFFBBF24).copy(alpha = 0.08f)
        else -> MaterialTheme.colorScheme.surface
    }
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min).background(bg)
            .combinedClickable(onClick = onClick, onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); onLongClick() }, onLongClickLabel = "Select"),
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(if (r.flags > 0) FlagColors[r.flags] else Color.Transparent))
        Row(Modifier.weight(1f).padding(start = 9.dp, end = 16.dp, top = 9.dp, bottom = 9.dp)) {
            if (selecting) Box(Modifier.height(ROW_LINE).padding(end = 10.dp), contentAlignment = Alignment.Center) {
                Icon(if (selected) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked, if (selected) "Selected" else "Not selected", Modifier.size(20.dp), tint = if (selected) appColors.brand else MaterialTheme.colorScheme.outline)
            }
            if ("order" in shown) Box(Modifier.width(30.dp).height(ROW_LINE), contentAlignment = Alignment.CenterEnd) {
                Text("${r.order}", fontSize = 12.sp, color = appColors.faint, maxLines = 1)
            }
            if ("state" in shown) Box(Modifier.padding(start = if ("order" in shown) 10.dp else 0.dp, end = 10.dp).height(ROW_LINE), contentAlignment = Alignment.Center) { StateDot(r.state) }
            else if ("order" in shown) Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(r.sortField.ifBlank { r.question }, Modifier.weight(1f, fill = false), fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (r.marked && "state" !in shown) Icon(Icons.Default.Star, "Marked", Modifier.padding(start = 4.dp).size(14.dp), tint = Color(0xFFF59E0B))
                }
                if ("answer" in shown && r.answer.isNotBlank()) Text(r.answer, fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val details = buildList {
                    if ("deck" in shown) add(r.deck.substringAfterLast("::"))
                    if ("due" in shown && r.due.isNotBlank()) add(r.due)
                    if ("ivl" in shown) add("Interval ${r.ivl}")
                    if ("ease" in shown && r.ease.isNotBlank()) add("Ease ${r.ease}")
                    if ("reps" in shown) add("${r.reps} review${if (r.reps == 1) "" else "s"}")
                    if ("lapses" in shown) add("${r.lapses} lapse${if (r.lapses == 1) "" else "s"}")
                    if ("notetype" in shown) add(r.notetype)
                    if ("template" in shown && r.template.isNotBlank()) add(r.template)
                    if ("layout" in shown) add("Display order: ${r.layout}")
                    if ("created" in shown) add("Created ${r.created}")
                    if ("modified" in shown) add("Modified ${r.modified}")
                    if ("tags" in shown && r.tags.isNotEmpty()) add(r.tags.joinToString(" ") { "#$it" })
                }
                if (details.isNotEmpty()) Text(details.joinToString(" · "), fontSize = 12.sp, lineHeight = 17.sp, color = appColors.faint, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 1.dp))
            }
        }
    }
}

/** Actions for the selected cards, like the web app's selection toolbar. */
@Composable
private fun SelectionActions(app: AppState, b: BrowseState) {
    val scope = rememberCoroutineScope()
    var flagMenu by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<String?>(null) }
    val n = b.selected.size
    val selRows = b.rows.filter { it.id in b.selected }
    val anySuspended = selRows.any { it.queue == -1 }
    fun run(msg: String?, f: suspend () -> Unit) = scope.launch {
        try { f(); msg?.let { app.notice = it }; b.reload(app) } catch (e: Exception) { app.notice = e.message }
    }
    fun cardAct(action: String, msg: String, extra: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit = {}) = run(msg) {
        app.api.post<Changed>("/api/cards/actions", buildJsonObject { put("action", action); putJsonArray("cardIds") { b.selected.forEach { add(it) } }; extra() })
    }
    fun tags(add: Boolean, list: List<String>) = run(if (add) "Tags added" else "Tags removed") {
        val nids = b.selectedNotes(app)
        app.api.post<JsonObject>("/api/notes/tags", buildJsonObject { putJsonArray("noteIds") { nids.forEach { add(it) } }; putJsonArray(if (add) "add" else "remove") { list.forEach { add(it) } } })
    }
    fun duplicate() = run(null) {
        val r = app.api.post<Duplicated>("/api/notes/duplicate", buildJsonObject { putJsonArray("cardIds") { b.selected.forEach { add(it) } } })
        app.notice = "Duplicated ${r.notes} note${if (r.notes == 1) "" else "s"} (${r.cards} card${if (r.cards == 1) "" else "s"})"
        b.selected = emptySet()
    }
    Surface(color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp)) {
            @Composable fun action(label: String, icon: ImageVector, onClick: () -> Unit, content: @Composable () -> Unit = {}) = Box(Modifier.weight(1f)) {
                Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(icon, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(label, fontSize = 11.sp, lineHeight = 14.sp, maxLines = 1, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(top = 2.dp))
                }
                content()
            }
            action("Display order", Icons.Default.Dashboard, { app.push(Screen.DisplayOrder(b.selected.toList())) })
            action("Duplicate", Icons.Default.ContentCopy, { if (n > 1) dialog = "duplicate" else duplicate() })
            action("Flag", Icons.Default.Flag, { flagMenu = true }) {
                DropdownMenu(flagMenu, { flagMenu = false }) {
                    (1..7).forEach { f ->
                        DropdownMenuItem(leadingIcon = { Icon(Icons.Default.Flag, null, tint = FlagColors[f]) }, text = { Text(FlagNames[f]) }, onClick = { flagMenu = false; cardAct("flag", "Flagged ${FlagNames[f].lowercase()}") { put("flag", f) } })
                    }
                    HorizontalDivider()
                    DropdownMenuItem(leadingIcon = { Icon(Icons.Default.Flag, null, tint = MaterialTheme.colorScheme.outline) }, text = { Text("Remove flag") }, onClick = { flagMenu = false; cardAct("flag", "Flag removed") { put("flag", 0) } })
                }
            }
            if (anySuspended) action("Unsuspend", Icons.Default.PlayCircle, { cardAct("unsuspend", "Unsuspended") })
            else action("Suspend", Icons.Default.PauseCircle, { cardAct("suspend", "Suspended") })
            action("More", Icons.Default.MoreHoriz, { more = true }) {
                DropdownMenu(more, { more = false }) {
                    @Composable fun item(label: String, icon: ImageVector, danger: Boolean = false, onClick: () -> Unit) = DropdownMenuItem(
                        text = { Text(label, color = if (danger) MaterialTheme.colorScheme.error else Color.Unspecified) },
                        leadingIcon = { Icon(icon, null, Modifier.size(20.dp), tint = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) },
                        onClick = { more = false; onClick() },
                    )
                    val allMarked = selRows.isNotEmpty() && selRows.all { it.marked }
                    item(if (allMarked) "Unmark" else "Mark", Icons.Default.Star) { tags(!allMarked, listOf("marked")) }
                    val anyBuried = selRows.any { it.queue == -2 || it.queue == -3 }
                    item(if (anyBuried) "Unbury" else "Bury", Icons.Default.VisibilityOff) { cardAct(if (anyBuried) "unbury" else "bury", if (anyBuried) "Unburied" else "Buried") }
                    item("Change deck", Icons.AutoMirrored.Filled.DriveFileMove) { dialog = "deck" }
                    item("Add tags", Icons.AutoMirrored.Filled.Label) { dialog = "tags-add" }
                    item("Remove tags", Icons.AutoMirrored.Filled.LabelOff) { dialog = "tags-remove" }
                    item("Reset (forget)", Icons.Default.RestartAlt) { dialog = "forget" }
                    HorizontalDivider()
                    item("Delete notes", Icons.Default.Delete, danger = true) { dialog = "delete" }
                }
            }
        }
    }
    val what = "$n card${if (n == 1) "" else "s"}"
    when (dialog) {
        "duplicate" -> Confirm("Duplicate $what?", "Each copy is a new note created now, with the same fields and tags, in the same deck. Copies start as new cards.", "Duplicate", onDismiss = { dialog = null }) { duplicate() }
        "forget" -> Confirm("Reset $what?", "They become new cards again. Their review history is kept.", "Reset", onDismiss = { dialog = null }) { cardAct("forget", "Reset to new") }
        "delete" -> Confirm("Delete the notes of $what?", "This deletes the notes and all of their cards, including cards that aren't selected.", "Delete", danger = true, onDismiss = { dialog = null }) {
            run("Notes deleted") {
                val nids = b.selectedNotes(app)
                app.api.post<JsonObject>("/api/notes/delete", buildJsonObject { putJsonArray("noteIds") { nids.forEach { add(it) } } })
                b.selected = emptySet()
            }
        }
        "deck" -> DeckPicker(app, onDismiss = { dialog = null }) { d -> dialog = null; cardAct("setDeck", "Moved to ${d.name.substringAfterLast("::")}") { put("deckId", d.id) } }
        "tags-add", "tags-remove" -> {
            val adding = dialog == "tags-add"
            TagsDialog(adding, onDismiss = { dialog = null }) { list -> dialog = null; tags(adding, list) }
        }
    }
}

@Composable
fun Confirm(title: String, text: String, confirm: String, danger: Boolean = false, onDismiss: () -> Unit, onConfirm: () -> Unit) = AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text(title) },
    text = { Text(text) },
    confirmButton = { TextButton(onClick = { onDismiss(); onConfirm() }) { Text(confirm, color = if (danger) MaterialTheme.colorScheme.error else Color.Unspecified) } },
    dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
)

@Composable
private fun DeckPicker(app: AppState, onDismiss: () -> Unit, onPick: (DeckListItem) -> Unit) {
    var decks by remember { mutableStateOf<List<DeckListItem>?>(null) }
    LaunchedEffect(Unit) { decks = try { app.api.get<List<DeckListItem>>("/api/decks/list").filter { it.kind == 0 }.sortedBy { it.name.lowercase() } } catch (_: Exception) { emptyList() } }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Move to deck") },
        text = {
            LazyColumn(Modifier.heightIn(max = 380.dp)) {
                items(decks ?: emptyList(), key = { it.id }) { d ->
                    val depth = d.name.split("::").size - 1
                    Text(d.name.substringAfterLast("::"), Modifier.fillMaxWidth().clickable { onPick(d) }.padding(start = (depth * 16).dp, top = 12.dp, bottom = 12.dp), fontSize = 15.sp)
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun TagsDialog(add: Boolean, onDismiss: () -> Unit, onApply: (List<String>) -> Unit) {
    var text by remember { mutableStateOf("") }
    val list = text.split(" ", ",").map { it.trim() }.filter { it.isNotEmpty() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (add) "Add tags" else "Remove tags") },
        text = { OutlinedTextField(text, { text = it }, label = { Text("Tags (space separated)") }, singleLine = true, keyboardOptions = KeyboardOptions(autoCorrectEnabled = false)) },
        confirmButton = { TextButton(enabled = list.isNotEmpty(), onClick = { onApply(list) }) { Text(if (add) "Add" else "Remove") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Saved searches, card states, flags, decks, note types, display orders and tags (the web app's Browse sidebar). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterSheet(app: AppState, current: String, onDismiss: () -> Unit, onSearch: (String) -> Unit) {
    var decks by remember { mutableStateOf<List<DeckListItem>>(emptyList()) }
    var nts by remember { mutableStateOf<List<Notetype>>(emptyList()) }
    var tags by remember { mutableStateOf<List<String>>(emptyList()) }
    var layouts by remember { mutableStateOf<List<LayoutFamily>>(emptyList()) }
    LaunchedEffect(Unit) {
        try {
            decks = app.api.get<List<DeckListItem>>("/api/decks/list").sortedBy { it.name.lowercase() }
            nts = app.api.get<List<Notetype>>("/api/notetypes")
            layouts = app.api.get<List<LayoutFamily>>("/api/layouts")
            tags = app.api.get<List<String>>("/api/tags")
        } catch (_: Exception) {}
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surface) {
        Text("Filters", fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.padding(start = 20.dp, bottom = 4.dp))
        LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(bottom = 32.dp)) {
            fun section(title: String) = item(key = "s-$title") {
                Text(title.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 4.dp))
            }
            fun entry(q: String, label: String, depth: Int = 0, dot: (@Composable () -> Unit)? = null) = item(key = "q-$q") {
                val on = q == current
                Row(
                    Modifier.fillMaxWidth().clickable { onSearch(q) }.background(if (on) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)
                        .padding(start = (20 + depth * 16).dp, end = 20.dp).height(44.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    dot?.let { Box(Modifier.padding(end = 12.dp)) { it() } }
                    Text(label, Modifier.weight(1f), fontSize = 15.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (on) Icon(Icons.Default.Check, "Current", Modifier.size(18.dp), tint = appColors.brand)
                }
            }
            section("Saved searches")
            entry("", "Whole collection"); entry("deck:current", "Current deck"); entry("added:1", "Added today")
            entry("rated:1", "Studied today"); entry("rated:1:1", "Again today"); entry("edited:1", "Edited today")
            section("Card state")
            listOf("is:new" to "new", "is:learn" to "learning", "is:review" to "review", "is:due" to "due", "is:suspended" to "suspended", "is:buried" to "buried", "tag:marked" to "marked", "tag:leech" to "leech").forEach { (q, st) ->
                entry(q, CARD_STATES[st]!!.label.substringBefore(" ("), dot = { StateDot(st, 9) })
            }
            section("Flags")
            (1..7).forEach { f -> entry("flag:$f", FlagNames[f], dot = { Box(Modifier.size(9.dp).background(FlagColors[f], RoundedCornerShape(50))) }) }
            if (decks.isNotEmpty()) { section("Decks"); decks.forEach { d -> entry(deckQuery(d.name), d.name.substringAfterLast("::"), d.name.split("::").size - 1) } }
            if (nts.isNotEmpty()) { section("Note types"); nts.forEach { n -> entry(searchTerm("note", n.name), n.name) } }
            if (layouts.isNotEmpty()) {
                // a layout is a copy of its note type, so filtering by layout is a note-type search on the exact name
                section("Display order")
                val ntName = { id: Long -> nts.firstOrNull { it.id == id }?.name }
                layouts.forEach { f ->
                    val names = f.layouts.mapNotNull { ntName(it.notetypeId) }
                    entry(if (names.size > 1) names.joinToString(" OR ", "(", ")") { searchTerm("note", it) } else searchTerm("note", f.notetype), f.notetype)
                    f.layouts.forEach { l -> ntName(l.notetypeId)?.let { entry(searchTerm("note", it), l.name, 1) } }
                }
            }
            section("Tags")
            if (tags.isEmpty()) item { Text("No tags", Modifier.padding(start = 20.dp, top = 6.dp), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            tags.forEach { t -> entry(searchTerm("tag", t), t.substringAfterLast("::"), t.split("::").size - 1) }
        }
    }
}

/** Which details each row shows (the web app's Columns dialog). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ColumnsSheet(b: BrowseState, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surface) {
        Text("Show in each row", fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.padding(start = 20.dp, bottom = 8.dp))
        LazyColumn(contentPadding = PaddingValues(bottom = 32.dp)) {
            items(COLUMNS, key = { it.first }) { (k, label) ->
                val on = k in b.shown
                Row(Modifier.fillMaxWidth().clickable { b.toggle(k, !on) }.padding(horizontal = 20.dp).height(52.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(label, Modifier.weight(1f), fontSize = 15.sp)
                    Switch(on, { b.toggle(k, it) }, colors = SwitchDefaults.colors(checkedTrackColor = BrandDark))
                }
            }
        }
    }
}
