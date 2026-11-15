package com.betteranki.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.betteranki.app.AppState
import com.betteranki.app.data.AppConfig
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlin.math.roundToInt

// Option lists, the same as the web app's deck options.
private val NEW_GATHER = listOf(0 to "Deck", 5 to "Deck, then random notes", 1 to "Ascending position", 2 to "Descending position", 3 to "Random notes", 4 to "Random cards")
private val NEW_SORT = listOf("Card type, then order gathered", "Order gathered", "Card type, then random", "Random note, then card type", "Random").mapIndexed { i, l -> i to l }
private val MIX = listOf("Mix with reviews", "Show after reviews", "Show before reviews").mapIndexed { i, l -> i to l }
private val REVIEW_ORDER = listOf(
    0 to "Due date, then random", 1 to "Due date, then deck", 2 to "Deck, then due date", 3 to "Ascending intervals", 4 to "Descending intervals",
    5 to "Ascending ease", 6 to "Descending ease", 7 to "Ascending retrievability", 11 to "Descending retrievability", 12 to "Relative overdueness",
    8 to "Random", 9 to "Order added", 10 to "Reverse order added",
)
private val AUTO_ANSWER = listOf("Bury card", "Answer Again", "Answer Good", "Answer Hard", "Show reminder").mapIndexed { i, l -> i to l }

/** Steps in minutes as "1m 10m 1d" (same format as the web app). */
private fun stepsToText(a: JsonArray?) = a.orEmpty().mapNotNull { it.jsonPrimitive.doubleOrNull }.joinToString(" ") { m ->
    when {
        m >= 1440 && m % 1440 == 0.0 -> "${(m / 1440).toLong()}d"
        m >= 60 && m % 60 == 0.0 -> "${(m / 60).toLong()}h"
        m < 1 -> "${(m * 60).roundToInt()}s"
        m % 1 == 0.0 -> "${m.toLong()}m"
        else -> "${m}m"
    }
}
private fun textToSteps(t: String): List<Double>? = t.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.map { part ->
    val m = Regex("^(\\d+(?:\\.\\d+)?)([smhd]?)$").find(part) ?: return null
    val v = m.groupValues[1].toDouble()
    when (m.groupValues[2]) { "s" -> v / 60; "h" -> v * 60; "d" -> v * 1440; else -> v }
}

/** A deck's options preset, edited the same way as on the web. Changes apply to every deck using the preset. */
@Composable
fun DeckOptionsScreen(app: AppState, deckId: Long) {
    val scope = rememberCoroutineScope()
    var deckName by remember { mutableStateOf("") }
    var deckConf by remember { mutableStateOf(0L) }
    // per-deck daily limits (override the preset's for this deck only)
    var hadOverride by remember { mutableStateOf(false) }
    var ownLimits by remember { mutableStateOf(false) }
    var deckNew by remember { mutableStateOf<Long?>(null) }
    var deckRev by remember { mutableStateOf<Long?>(null) }
    var presets by remember { mutableStateOf<List<JsonObject>?>(null) }
    var fsrs by remember { mutableStateOf(false) }
    var confId by remember { mutableStateOf(0L) }
    var c by remember { mutableStateOf<Map<String, JsonElement>>(emptyMap()) }
    var learn by remember { mutableStateOf("") }
    var relearn by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf<String?>(null) } // "new", "clone", "rename"
    var deleting by remember { mutableStateOf(false) }

    fun pick(id: Long, list: List<JsonObject>? = presets) {
        val p = list?.firstOrNull { it.long("id") == id } ?: return
        confId = id
        c = p.toMap()
        learn = stepsToText(p["learnSteps"]?.jsonArray)
        relearn = stepsToText(p["relearnSteps"]?.jsonArray)
    }
    suspend fun loadPresets(select: Long?) {
        val list = app.api.get<List<JsonObject>>("/api/deck-configs")
        presets = list
        pick(select ?: confId, list)
    }
    LaunchedEffect(deckId) {
        try {
            val d = app.api.get<JsonObject>("/api/decks/$deckId")["deck"]!!.jsonObject
            deckName = d["name"]?.jsonPrimitive?.content ?: ""
            deckConf = d.long("configId") ?: 1
            deckNew = d.long("newLimit")
            deckRev = d.long("reviewLimit")
            hadOverride = deckNew != null || deckRev != null
            ownLimits = hadOverride
            fsrs = app.api.get<AppConfig>("/api/config").fsrs
            loadPresets(deckConf)
        } catch (e: Exception) { error = e.message }
    }

    fun num(k: String) = c[k]?.jsonPrimitive?.doubleOrNull ?: 0.0
    fun bool(k: String) = c[k]?.jsonPrimitive?.booleanOrNull ?: false
    fun set(k: String, v: Number) { c = c + (k to JsonPrimitive(v)) }
    fun set(k: String, v: Boolean) { c = c + (k to JsonPrimitive(v)) }
    val useCount = presets?.firstOrNull { it.long("id") == confId }?.long("useCount") ?: 0L

    fun save() = scope.launch {
        val ls = textToSteps(learn)
        val rs = textToSteps(relearn)
        if (ls == null || rs == null) { error = "Steps must look like: 1m 10m 1d"; return@launch }
        busy = true
        try {
            val body = JsonObject(c - "useCount" + mapOf("learnSteps" to JsonArray(ls.map { JsonPrimitive(it) }), "relearnSteps" to JsonArray(rs.map { JsonPrimitive(it) })))
            app.api.put<JsonObject>("/api/deck-configs/$confId", body)
            val patch = buildJsonObject {
                if (confId != deckConf) put("configId", confId)
                if (ownLimits) { put("newLimit", deckNew ?: num("newPerDay").toLong()); put("reviewLimit", deckRev ?: num("reviewsPerDay").toLong()) }
                else if (hadOverride) { put("newLimit", JsonNull); put("reviewLimit", JsonNull) }
            }
            if (patch.isNotEmpty()) app.api.request("PATCH", "/api/decks/$deckId", patch, JsonObject.serializer())
            app.notice = "Options saved"
            app.changeTick++
            app.pop()
        } catch (e: Exception) { error = e.message } finally { busy = false }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { app.pop() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text(deckName.substringAfterLast("::"), Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            Button(onClick = { save() }, enabled = presets != null && !busy, shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.buttonColors(containerColor = Brand), modifier = Modifier.padding(end = 8.dp)) { Text("Save") }
        }
        val list = presets
        if (list == null) { error?.let { ErrorBox(it, Modifier.padding(16.dp)) } ?: Loading(); return@Column }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Deck options", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            error?.let { ErrorBox(it) }
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Dropdown("Preset", list, list.firstOrNull { it.long("id") == confId }, { "${it.str("name")} (${it.long("useCount")} deck${if (it.long("useCount") == 1L) "" else "s"})" }, { pick(it.long("id")!!) }, Modifier.weight(1f))
                        Box {
                            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "Manage presets") }
                            DropdownMenu(menu, { menu = false }) {
                                @Composable fun item(label: String, icon: ImageVector, enabled: Boolean = true, danger: Boolean = false, onClick: () -> Unit) = DropdownMenuItem(
                                    text = { Text(label, color = if (danger) MaterialTheme.colorScheme.error else Color.Unspecified) },
                                    leadingIcon = { Icon(icon, null, Modifier.size(20.dp), tint = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) },
                                    enabled = enabled, onClick = { menu = false; onClick() },
                                )
                                item("Add preset", Icons.Default.Add) { naming = "new" }
                                item("Clone preset", Icons.Default.ContentCopy) { naming = "clone" }
                                item("Rename preset", Icons.Default.Edit) { naming = "rename" }
                                HorizontalDivider(Modifier.padding(vertical = 4.dp))
                                item("Delete preset", Icons.Default.Delete, enabled = confId != 1L, danger = true) { deleting = true }
                            }
                        }
                    }
                    val others = useCount - (if (confId == deckConf) 1 else 0)
                    Text(
                        if (confId != deckConf) "Saving switches this deck to this preset." else if (others > 0) "Changes apply to all ${useCount} decks using this preset." else "Only this deck uses this preset.",
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
            // reset the text fields when switching presets
            key(confId) {
                Section("Daily limits") {
                    Segmented(listOf(false, true), ownLimits, { Text(if (it) "This deck" else "Preset", fontSize = 14.sp) }, { ownLimits = it })
                    if (ownLimits) key("deck") {
                        Pair2(
                            { NumField("New cards/day", (deckNew ?: num("newPerDay").toLong()).toDouble(), it) { v -> deckNew = v.toLong() } },
                            { NumField("Maximum reviews/day", (deckRev ?: num("reviewsPerDay").toLong()).toDouble(), it) { v -> deckRev = v.toLong() } },
                        )
                        Hint("Only ${deckName.substringAfterLast("::")} uses these. The preset's limits are ${num("newPerDay").toLong()} new and ${num("reviewsPerDay").toLong()} reviews a day.")
                    } else key("preset") {
                        Pair2({ NumField("New cards/day", num("newPerDay"), it) { v -> set("newPerDay", v.toInt()) } }, { NumField("Maximum reviews/day", num("reviewsPerDay"), it) { v -> set("reviewsPerDay", v.toInt()) } })
                        if (hadOverride) Hint("Saving removes this deck's own limits.")
                    }
                    OptSwitch("New cards ignore review limit", null, bool("newIgnoreReviewLimit")) { set("newIgnoreReviewLimit", it) }
                }
                Section("New cards") {
                    TextOpt("Learning steps", learn, "e.g. 1m 10m 1h 1d") { learn = it }
                    if (!fsrs) Pair2({ NumField("Graduating interval (days)", num("graduatingIvl"), it) { v -> set("graduatingIvl", v.toInt()) } }, { NumField("Easy interval (days)", num("easyIvl"), it) { v -> set("easyIvl", v.toInt()) } })
                    Choice("Insertion order", listOf(0 to "Sequential (oldest first)", 1 to "Random"), num("newInsertOrder").toInt()) { set("newInsertOrder", it) }
                }
                Section("Lapses") {
                    TextOpt("Relearning steps", relearn, "e.g. 10m") { relearn = it }
                    Pair2({ NumField("Minimum interval (days)", num("minLapseIvl"), it) { v -> set("minLapseIvl", v.toInt()) } }, { NumField("Leech threshold", num("leechThreshold"), it, hint = "0 = off") { v -> set("leechThreshold", v.toInt()) } })
                    Choice("Leech action", listOf(0 to "Suspend card", 1 to "Tag only"), num("leechAction").toInt()) { set("leechAction", it) }
                }
                Section("Display order") {
                    Choice("New card gather order", NEW_GATHER, num("newGatherPriority").toInt()) { set("newGatherPriority", it) }
                    Choice("New card sort order", NEW_SORT, num("newSortOrder").toInt()) { set("newSortOrder", it) }
                    Choice("New/review order", MIX, num("newMix").toInt()) { set("newMix", it) }
                    Choice("Interday learning/review order", MIX, num("interdayLearningMix").toInt()) { set("interdayLearningMix", it) }
                    Choice("Review sort order", REVIEW_ORDER, num("reviewOrder").toInt()) { set("reviewOrder", it) }
                }
                Section(if (fsrs) "FSRS" else "FSRS (off: turn it on in Settings)") {
                    val dr = num("desiredRetention").toFloat().coerceIn(0.7f, 0.99f)
                    Text("Desired retention: ${(dr * 100).roundToInt()}%", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    Slider(dr, { set("desiredRetention", (it * 100).roundToInt() / 100.0) }, valueRange = 0.7f..0.99f, colors = SliderDefaults.colors(thumbColor = Brand, activeTrackColor = Brand))
                    Hint("Higher retention means more reviews. 85–92% is a good range for most people.")
                    if (fsrs) NumField("Maximum interval (days)", num("maxIvl"), Modifier.fillMaxWidth()) { v -> set("maxIvl", v.toInt()) }
                    Hint("FSRS parameters, optimizing them, and easy days are set in the web app.")
                }
                if (!fsrs) Section("Advanced (SM-2)") {
                    Pair2({ NumField("Starting ease", num("initialEase"), it, decimal = true) { v -> set("initialEase", v) } }, { NumField("Easy bonus", num("easyMult"), it, decimal = true) { v -> set("easyMult", v) } })
                    Pair2({ NumField("Interval modifier", num("ivlMult"), it, decimal = true) { v -> set("ivlMult", v) } }, { NumField("Hard interval", num("hardMult"), it, decimal = true) { v -> set("hardMult", v) } })
                    Pair2({ NumField("New interval", num("lapseMult"), it, decimal = true, hint = "Multiplier on lapse") { v -> set("lapseMult", v) } }, { NumField("Maximum interval (days)", num("maxIvl"), it) { v -> set("maxIvl", v.toInt()) } })
                }
                Section("Burying") {
                    OptSwitch("Bury new siblings", "Delay other new cards of the same note until tomorrow", bool("buryNew")) { set("buryNew", it) }
                    OptSwitch("Bury review siblings", null, bool("buryReviews")) { set("buryReviews", it) }
                    OptSwitch("Bury interday learning siblings", null, bool("buryInterday")) { set("buryInterday", it) }
                }
                Section("Audio") {
                    OptSwitch("Play audio automatically", null, !bool("disableAutoplay")) { set("disableAutoplay", !it) }
                    OptSwitch("Skip question audio when replaying answer", null, bool("skipQuestionWhenReplayingAnswer")) { set("skipQuestionWhenReplayingAnswer", it) }
                }
                Section("Timer & auto advance") {
                    OptSwitch("Show answer timer", null, bool("showTimer")) { set("showTimer", it) }
                    NumField("Maximum answer seconds", num("capAnswerSecs"), Modifier.fillMaxWidth()) { v -> set("capAnswerSecs", v.toInt()) }
                    Pair2({ NumField("Seconds to show question", num("autoAdvanceQuestionSecs"), it, decimal = true, hint = "0 = off") { v -> set("autoAdvanceQuestionSecs", v) } }, { NumField("Seconds to show answer", num("autoAdvanceAnswerSecs"), it, decimal = true, hint = "0 = off") { v -> set("autoAdvanceAnswerSecs", v) } })
                    Choice("Answer action", AUTO_ANSWER, num("autoAdvanceAnswerAction").toInt()) { set("autoAdvanceAnswerAction", it) }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    naming?.let { mode ->
        var name by remember(mode) { mutableStateOf(when (mode) { "clone" -> "${c.str("name")} copy"; "rename" -> c.str("name"); else -> "" }) }
        AlertDialog(
            onDismissRequest = { naming = null },
            title = { Text(when (mode) { "new" -> "New preset"; "clone" -> "Clone preset"; else -> "Rename preset" }) },
            text = { OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("Name") }) },
            confirmButton = {
                TextButton(enabled = name.isNotBlank(), onClick = {
                    naming = null
                    if (mode == "rename") { c = c + ("name" to JsonPrimitive(name.trim())); return@TextButton }
                    scope.launch {
                        try {
                            val p = app.api.post<JsonObject>("/api/deck-configs", buildJsonObject { put("name", name.trim()); if (mode == "clone") put("cloneFrom", confId) })
                            loadPresets(p.long("id"))
                        } catch (e: Exception) { error = e.message }
                    }
                }) { Text(when (mode) { "new" -> "Add"; "clone" -> "Clone"; else -> "Rename" }) }
            },
            dismissButton = { TextButton(onClick = { naming = null }) { Text("Cancel") } },
        )
    }
    if (deleting) Confirm("Delete preset “${c.str("name")}”?", "Decks using it switch to the default preset.", "Delete", danger = true, onDismiss = { deleting = false }) {
        scope.launch {
            try {
                app.api.delete<JsonObject>("/api/deck-configs/$confId")
                if (deckConf == confId) deckConf = 1
                loadPresets(1)
            } catch (e: Exception) { error = e.message }
        }
    }
}

private fun JsonObject.long(k: String) = this[k]?.jsonPrimitive?.longOrNull
private fun JsonObject.str(k: String) = this[k]?.jsonPrimitive?.content ?: ""
private fun Map<String, JsonElement>.str(k: String) = (this[k] as? JsonPrimitive)?.content ?: ""

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            content()
        }
    }
}

@Composable
private fun Hint(text: String) = Text(text, fontSize = 12.sp, lineHeight = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

/** Two fields side by side. */
@Composable
private fun Pair2(a: @Composable (Modifier) -> Unit, b: @Composable (Modifier) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Bottom) {
        a(Modifier.weight(1f))
        b(Modifier.weight(1f))
    }
}

@Composable
private fun NumField(label: String, value: Double, modifier: Modifier, decimal: Boolean = false, hint: String? = null, onChange: (Double) -> Unit) {
    var text by remember { mutableStateOf(if (decimal) value.toString().removeSuffix(".0") else value.toLong().toString()) }
    val bad = text.toDoubleOrNull() == null || (!decimal && text.toLongOrNull() == null)
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, modifier = Modifier.padding(bottom = 4.dp))
        OutlinedTextField(
            text, { t -> text = t; t.toDoubleOrNull()?.let { if (decimal || t.toLongOrNull() != null) onChange(it) } },
            singleLine = true, isError = bad, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Number),
            supportingText = hint?.let { { Text(it, fontSize = 11.sp) } },
        )
    }
}

@Composable
private fun TextOpt(label: String, value: String, hint: String, onChange: (String) -> Unit) {
    val bad = textToSteps(value) == null
    Column {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 4.dp))
        OutlinedTextField(
            value, onChange, singleLine = true, isError = bad, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth(),
            textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
            supportingText = { Text(if (bad) "Use numbers with s, m, h or d, like 1m 10m 1d" else hint, fontSize = 11.sp) },
        )
    }
}

@Composable
private fun Choice(label: String, options: List<Pair<Int, String>>, value: Int, onPick: (Int) -> Unit) =
    Dropdown(label, options, options.firstOrNull { it.first == value }, { it.second }, { onPick(it.first) }, Modifier.fillMaxWidth())

@Composable
private fun OptSwitch(title: String, hint: String?, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, fontSize = 15.sp)
            hint?.let { Text(it, fontSize = 12.sp, lineHeight = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Switch(value, onChange, colors = SwitchDefaults.colors(checkedTrackColor = BrandDark))
    }
}
