package com.betteranki.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.betteranki.app.AppState
import com.betteranki.app.data.Changed
import com.betteranki.app.data.LayoutOptions
import kotlinx.coroutines.launch
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

private const val NEW = -1L

/**
 * Display order: choose which front/back layout the selected cards use, or make a new one (the web app's dialog).
 * A layout is a copy of the cards' note type with that card type's template changed (server/src/layouts.ts), so
 * only the selected cards change and they keep their review history.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DisplayOrderScreen(app: AppState, cardIds: List<Long>) {
    var data by remember { mutableStateOf<LayoutOptions?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var choice by remember { mutableStateOf<Long?>(null) }
    var name by remember { mutableStateOf("") }
    var qfmt by remember { mutableStateOf(TextFieldValue("")) }
    var afmt by remember { mutableStateOf(TextFieldValue("")) }
    var lastBack by remember { mutableStateOf(false) } // which template the field buttons insert into
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(cardIds) {
        try {
            val d = app.api.post<LayoutOptions>("/api/layouts/options", buildJsonObject { putJsonArray("cardIds") { cardIds.forEach { add(it) } } })
            data = d
            if (d.ok) {
                // start on the layout most of the selected cards use
                val current = d.options.maxByOrNull { it.selected } ?: d.options.first()
                choice = current.notetypeId
                qfmt = TextFieldValue(current.qfmt); afmt = TextFieldValue(current.afmt)
            }
        } catch (e: Exception) { error = e.message }
    }
    val d = data
    val opts = if (d?.ok == true) d.options else emptyList()
    val chosen = opts.firstOrNull { it.notetypeId == choice }
    val canApply = if (choice == NEW) name.isNotBlank() && qfmt.text.isNotBlank() else chosen != null && chosen.selected != cardIds.size
    val n = cardIds.size
    fun apply() {
        busy = true
        scope.launch {
            try {
                if (choice == NEW) {
                    val r = app.api.post<Changed>("/api/layouts$HISTORY", buildJsonObject { putJsonArray("cardIds") { cardIds.forEach { add(it) } }; put("name", name.trim()); put("qfmt", qfmt.text); put("afmt", afmt.text) })
                    app.notice = "Created “${name.trim()}” for ${r.changed} card${if (r.changed == 1) "" else "s"}"
                } else {
                    val r = app.api.post<Changed>("/api/layouts/assign$HISTORY", buildJsonObject { putJsonArray("cardIds") { cardIds.forEach { add(it) } }; put("notetypeId", choice!!) })
                    app.notice = "${r.changed} card${if (r.changed == 1) " now uses" else "s now use"} “${chosen?.name}”"
                }
                app.browse.selected = emptySet()
                app.changeTick++
                app.pop()
            } catch (e: Exception) { error = e.message } finally { busy = false }
        }
    }
    fun insert(field: String) {
        val token = "{{$field}}"
        fun TextFieldValue.with(): TextFieldValue {
            val s = selection.min; val e = selection.max
            return TextFieldValue(text.substring(0, s) + token + text.substring(e), TextRange(s + token.length))
        }
        if (lastBack) afmt = afmt.with() else qfmt = qfmt.with()
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { app.pop() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Display order", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp)) {
            error?.let { ErrorBox(it, Modifier.padding(bottom = 12.dp)) }
            when {
                d == null && error == null -> Box(Modifier.fillMaxWidth().height(200.dp)) { Loading() }
                d != null && !d.ok -> Text(d.reason ?: "These cards can't change layout together.", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                d != null -> {
                    Text(
                        "Choose what the front and back of ${if (n == 1) "this card" else "these $n cards"} show. Only the selected cards change, and they keep their review history.",
                        fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text("${d.notetype} · ${d.cardType}", fontSize = 13.sp, color = appColors.faint, modifier = Modifier.padding(top = 4.dp, bottom = 14.dp))
                    Panel(Modifier.fillMaxWidth()) {
                        Column {
                            opts.forEachIndexed { i, o ->
                                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                                LayoutChoice(choice == o.notetypeId, { choice = o.notetypeId }, o.name, if (o.selected == n) "Current" else if (o.selected > 0) "${o.selected} selected use this" else null) {
                                    TemplateLine("Front", o.qfmt); TemplateLine("Back", o.afmt)
                                }
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                            LayoutChoice(choice == NEW, { choice = NEW }, "New layout", null, icon = true) {
                                Text("Start from the selected layout and change the front or back.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    if (choice == NEW) {
                        OutlinedTextField(
                            name, { name = it }, label = { Text("Name") }, placeholder = { Text("e.g. English → Spanish") }, singleLine = true,
                            modifier = Modifier.fillMaxWidth().padding(top = 16.dp), shape = RoundedCornerShape(10.dp),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                        )
                        FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Insert field:", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.align(Alignment.CenterVertically))
                            (d.fields + "FrontSide").forEach { f ->
                                Surface(onClick = { insert(f) }, shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                                    Text("{{$f}}", Modifier.padding(horizontal = 8.dp, vertical = 5.dp), fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                                }
                            }
                        }
                        val mono = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace, fontSize = 13.sp)
                        OutlinedTextField(
                            qfmt, { qfmt = it }, label = { Text("Front template") }, textStyle = mono, minLines = 4,
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp).onFocusChanged { if (it.isFocused) lastBack = false }, shape = RoundedCornerShape(10.dp),
                            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
                        )
                        OutlinedTextField(
                            afmt, { afmt = it }, label = { Text("Back template") }, textStyle = mono, minLines = 4,
                            supportingText = { Text("{{FrontSide}} repeats the front.") },
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp).onFocusChanged { if (it.isFocused) lastBack = true }, shape = RoundedCornerShape(10.dp),
                            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
                        )
                    }
                }
            }
        }
        if (d?.ok == true) Surface(color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
            Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp)) {
                Button(
                    enabled = canApply && !busy, onClick = { apply() },
                    modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = BrandDark, contentColor = Color.White),
                ) { Text(if (busy) "Applying…" else if (choice == NEW) "Create and apply" else "Apply", fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

@Composable
private fun LayoutChoice(checked: Boolean, onSelect: () -> Unit, title: String, note: String?, icon: Boolean = false, content: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(if (checked) appColors.brand.copy(alpha = 0.07f) else Color.Transparent)
            .clickable(onClick = onSelect).semantics { selected = checked; role = Role.RadioButton }.padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Surface(Modifier.padding(top = 2.dp).size(18.dp), shape = RoundedCornerShape(50), color = Color.Transparent, border = BorderStroke(if (checked) 5.dp else 1.5.dp, if (checked) BrandDark else MaterialTheme.colorScheme.outline)) {}
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (icon) Icon(Icons.Default.Add, null, Modifier.padding(end = 4.dp).size(16.dp))
                Text(title, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                note?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 8.dp)) }
            }
            Column(Modifier.padding(top = 4.dp)) { content() }
        }
    }
}

@Composable
private fun TemplateLine(label: String, value: String) {
    Row {
        Text(label, Modifier.width(44.dp), fontSize = 12.sp, color = appColors.faint)
        Text(value.replace(Regex("\\s+"), " ").trim().ifEmpty { "(empty)" }, fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
