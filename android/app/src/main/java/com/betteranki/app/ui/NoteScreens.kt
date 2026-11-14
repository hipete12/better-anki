package com.betteranki.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.betteranki.app.AppState
import com.betteranki.app.Screen
import com.betteranki.app.data.AddResult
import com.betteranki.app.data.AppConfig
import com.betteranki.app.data.DeckListItem
import com.betteranki.app.data.DeckOverview
import com.betteranki.app.data.NoteData
import com.betteranki.app.data.Notetype
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add

/** Plain-text field editing with a cloze helper; HTML is preserved as typed. */
@Composable
private fun FieldInput(label: String, value: TextFieldValue, onChange: (TextFieldValue) -> Unit, cloze: Boolean, allText: String) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            if (cloze) TextButton(onClick = {
                val n = (Regex("\\{\\{c(\\d+)::").findAll(allText).map { it.groupValues[1].toInt() }.maxOrNull() ?: 0) + 1
                val sel = value.selection
                val t = value.text
                val inner = t.substring(sel.min, sel.max)
                val ins = "{{c$n::$inner}}"
                val nt = t.substring(0, sel.min) + ins + t.substring(sel.max)
                onChange(TextFieldValue(nt, TextRange(sel.min + ins.length - if (inner.isEmpty()) 2 else 0)))
            }) { Text("[…] Cloze", fontSize = 12.sp) }
        }
        OutlinedTextField(value, onChange, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), minLines = 2)
    }
}

@Composable
fun AddNoteTab(app: AppState) {
    var notetypes by remember { mutableStateOf<List<Notetype>>(emptyList()) }
    var decks by remember { mutableStateOf<List<DeckListItem>>(emptyList()) }
    var nt by remember { mutableStateOf<Notetype?>(null) }
    var deck by remember { mutableStateOf<DeckListItem?>(null) }
    val fields = remember { mutableStateListOf<TextFieldValue>() }
    var tags by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        try {
            notetypes = app.api.get("/api/notetypes")
            decks = app.api.get<List<DeckListItem>>("/api/decks/list").filter { it.kind == 0 }
            val cfg = app.api.get<AppConfig>("/api/config")
            nt = notetypes.firstOrNull { it.id == cfg.lastNotetypeId } ?: notetypes.firstOrNull { it.name == "Basic" } ?: notetypes.firstOrNull()
            deck = decks.firstOrNull { it.id == cfg.lastDeckId } ?: decks.firstOrNull { it.id == cfg.currentDeckId } ?: decks.firstOrNull()
        } catch (e: Exception) { msg = (e.message ?: "Error") to false }
    }
    LaunchedEffect(nt) {
        val n = nt ?: return@LaunchedEffect
        while (fields.size < n.fields.size) fields.add(TextFieldValue(""))
        while (fields.size > n.fields.size) fields.removeAt(fields.lastIndex)
    }
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())) {
        TabHeader("Add")
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Dropdown("Type", notetypes, nt, { it.name }, { nt = it }, Modifier.weight(1f))
                Dropdown("Deck", decks, deck, { it.name }, { deck = it }, Modifier.weight(1f))
            }
            nt?.let { n ->
                n.fields.forEachIndexed { i, f ->
                    if (i < fields.size) FieldInput(f.name, fields[i], { fields[i] = it }, n.kind == 1 && i == 0, fields.joinToString(" ") { it.text })
                }
            }
            OutlinedTextField(tags, { tags = it }, label = { Text("Tags (space separated)") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
            msg?.let { (t, ok) -> if (ok) InfoBox(t, true) else ErrorBox(t) }
            Button(
                onClick = {
                    val n = nt ?: return@Button
                    val d = deck ?: return@Button
                    busy = true
                    scope.launch {
                        try {
                            val r = app.api.post<AddResult>("/api/notes", buildJsonObject {
                                put("notetypeId", n.id); put("deckId", d.id)
                                putJsonArray("fields") { fields.forEach { add(it.text.replace("\n", "<br>")) } }
                                putJsonArray("tags") { tags.split(" ").filter { it.isNotBlank() }.forEach { add(it) } }
                            })
                            msg = "Added ${r.cards} card${if (r.cards == 1) "" else "s"}" to true
                            for (i in fields.indices) fields[i] = TextFieldValue("")
                        } catch (e: Exception) { msg = (e.message ?: "Error") to false } finally { busy = false }
                    }
                },
                enabled = !busy && nt != null && deck != null,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = BrandDark, contentColor = Color.White),
            ) { Text("Add", fontSize = 16.sp) }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
fun EditNoteScreen(app: AppState, nid: Long) {
    var note by remember { mutableStateOf<NoteData?>(null) }
    val fields = remember { mutableStateListOf<TextFieldValue>() }
    var tags by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(nid) {
        try {
            val n = app.api.get<NoteData>("/api/notes/$nid")
            note = n
            fields.clear(); n.fields.forEach { fields.add(TextFieldValue(it)) }
            tags = n.tags.joinToString(" ")
        } catch (e: Exception) { error = e.message }
    }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { app.pop() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text(note?.notetype?.name ?: "Edit note", Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
            IconButton(onClick = { confirmDelete = true }, enabled = note != null) { Icon(Icons.Default.Delete, "Delete note") }
            TextButton(onClick = {
                scope.launch {
                    try {
                        app.api.put<JsonObject>("/api/notes/$nid", buildJsonObject {
                            putJsonArray("fields") { fields.forEach { add(it.text) } }
                            putJsonArray("tags") { tags.split(" ").filter { it.isNotBlank() }.forEach { add(it) } }
                        })
                        app.pop()
                    } catch (e: Exception) { error = e.message }
                }
            }, enabled = note != null) { Text("Save", fontWeight = FontWeight.SemiBold) }
        }
        error?.let { ErrorBox(it, Modifier.padding(16.dp)) }
        val n = note
        if (n == null) Loading()
        else Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            n.notetype.fields.forEachIndexed { i, f -> if (i < fields.size) FieldInput(f.name, fields[i], { fields[i] = it }, n.notetype.kind == 1 && i == 0, fields.joinToString(" ") { it.text }) }
            OutlinedTextField(tags, { tags = it }, label = { Text("Tags") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
            Text("Cards: " + n.cards.joinToString { "${it.template} (${it.deck})" }, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("Delete note?") },
        text = { Text("This deletes the note and all of its cards.") },
        confirmButton = { TextButton(onClick = { confirmDelete = false; scope.launch { try { app.api.post<JsonObject>("/api/notes/delete", buildJsonObject { putJsonArray("noteIds") { add(nid) } }); app.pop() } catch (e: Exception) { error = e.message } } }) { Text("Delete", color = Color(0xFFDC2626)) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
    )
}

@Composable
fun DeckOverviewScreen(app: AppState, id: Long) {
    var data by remember { mutableStateOf<DeckOverview?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun load() { try { data = app.api.get("/api/decks/$id"); error = null } catch (e: Exception) { error = e.message } }
    LaunchedEffect(id, app.changeTick) { load() }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { app.pop() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Decks", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        error?.let { ErrorBox(it, Modifier.padding(16.dp)) }
        val d = data ?: return@Column Loading()
        val parts = d.deck.name.split("::")
        Column(Modifier.padding(horizontal = 20.dp)) {
            if (parts.size > 1) Text(parts.dropLast(1).joinToString(" / "), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
            Text(parts.last(), style = MaterialTheme.typography.headlineMedium)
            d.configName?.let { Text("$it preset", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Spacer(Modifier.height(28.dp))
            val ac = appColors
            Row(horizontalArrangement = Arrangement.spacedBy(36.dp)) {
                Stat("${d.counts.new}", "New", color = if (d.counts.new > 0) ac.new else ac.faint, large = true)
                Stat("${d.counts.learn}", "Learning", color = if (d.counts.learn > 0) ac.learn else ac.faint, large = true)
                Stat("${d.counts.review}", "To review", color = if (d.counts.review > 0) ac.due else ac.faint, large = true)
            }
            Spacer(Modifier.height(28.dp))
            val due = d.counts.new + d.counts.learn + d.counts.review
            if (due > 0) Button(
                onClick = { app.push(Screen.Study(id)) },
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = BrandDark, contentColor = Color.White),
            ) { Text("Study now", fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
            else Text("Nothing due right now.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 15.sp)
            if (d.buried > 0) OutlinedButton(onClick = { scope.launch { app.api.post<JsonObject>("/api/decks/$id/unbury"); load() } }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), shape = RoundedCornerShape(10.dp)) { Text("Unbury ${d.buried} cards") }
            Text("Deck options, custom study and export are in the web app.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 16.dp))
        }
    }
}
