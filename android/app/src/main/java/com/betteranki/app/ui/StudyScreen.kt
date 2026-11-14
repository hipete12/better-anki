package com.betteranki.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Celebration
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.isSystemInDarkTheme
import com.betteranki.app.AppState
import com.betteranki.app.Screen
import com.betteranki.app.data.StudyState
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URI

private fun mediaBaseOf(html: String, fallback: String): String =
    Regex("<base href=\"([^\"]+)\"").find(html)?.groupValues?.get(1)?.replace("&amp;", "&") ?: fallback

@Composable
fun StudyScreen(app: AppState, deckId: Long) {
    val dark = isSystemInDarkTheme()
    val q = "?night=${if (dark) 1 else 0}&platform=android"
    var state by remember { mutableStateOf<StudyState?>(null) }
    var showAnswer by remember { mutableStateOf(false) }
    var answerHtml by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }
    var pendingLink by remember { mutableStateOf<String?>(null) }
    var shownAt by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val controller = remember { CardController() }
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current

    fun apply(s: StudyState) {
        state = s
        showAnswer = false
        answerHtml = null
        shownAt = System.currentTimeMillis()
    }
    suspend fun load() {
        try { apply(app.api.get<StudyState>("/api/study/$deckId$q")); error = null } catch (e: Exception) { error = e.message }
    }
    LaunchedEffect(deckId, dark) { load() }
    LaunchedEffect(toast) { if (toast != null) { delay(2500); toast = null } }

    val card = state?.card
    fun reveal() {
        val c = card ?: return
        if (showAnswer) return
        if (c.hasTypeAnswer) {
            controller.getTyped { typed ->
                scope.launch {
                    answerHtml = try {
                        app.api.post<JsonObject>("/api/study/answer-page", buildJsonObject { put("cardId", c.id); put("typed", typed ?: ""); put("night", dark); put("platform", "android") })["answer"]?.let { (it as kotlinx.serialization.json.JsonPrimitive).content }
                    } catch (e: Exception) { c.answer }
                    showAnswer = true
                }
            }
        } else {
            answerHtml = c.answer
            showAnswer = true
        }
    }
    fun answer(ease: Int) {
        val c = card ?: return
        if (busy || !showAnswer) return
        busy = true
        scope.launch {
            try {
                val s = app.api.post<StudyState>("/api/study/$deckId/answer$q", buildJsonObject { put("cardId", c.id); put("ease", ease); put("timeMs", System.currentTimeMillis() - shownAt) })
                if (s.answered?.leech == true) toast = if (s.answered.suspended) "Leech: card suspended" else "Leech: card tagged"
                apply(s)
            } catch (e: Exception) { toast = e.message } finally { busy = false }
        }
    }
    fun undo() = scope.launch {
        try { val s = app.api.post<StudyState>("/api/study/$deckId/undo$q"); s.undone?.let { toast = "Undid $it" }; apply(s) } catch (e: Exception) { toast = e.message }
    }
    fun action(act: String, extra: Map<String, Int> = emptyMap(), msg: String? = null) = scope.launch {
        val c = card ?: return@launch
        try {
            val s = app.api.post<StudyState>("/api/study/$deckId/action$q", buildJsonObject { put("cardId", c.id); put("action", act); extra.forEach { (k, v) -> put(k, v) } })
            msg?.let { toast = it }
            if (act == "flag" || act == "mark") state = state?.copy(card = state?.card?.copy(flags = s.card?.flags ?: 0, marked = s.card?.marked ?: false), undo = s.undo)
            else apply(s)
        } catch (e: Exception) { toast = e.message }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        // top bar
        Surface(color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.statusBarsPadding()) {
                Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { app.pop() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                    Column(Modifier.weight(1f)) {
                        Text(state?.deck?.name ?: "", fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 15.sp)
                        if (card != null && card.deckName != state?.deck?.name) Text(card.deckName, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    state?.let { CountsRow(it.counts.new, it.counts.learn, it.counts.review, card?.queueName) }
                    if ((card?.flags ?: 0) > 0) Icon(Icons.Default.Flag, null, Modifier.padding(start = 8.dp).size(18.dp), tint = FlagColors[card!!.flags])
                    if (card?.marked == true) Icon(Icons.Default.Star, null, Modifier.padding(start = 4.dp).size(18.dp), tint = Color(0xFFF59E0B))
                    IconButton(onClick = { undo() }, enabled = state?.undo?.available == true) { Icon(Icons.AutoMirrored.Filled.Undo, "Undo") }
                    if (card != null) Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
                        DropdownMenu(menu, { menu = false }) {
                            DropdownMenuItem(text = { Text("Edit note") }, onClick = { menu = false; app.push(Screen.EditNote(card.nid)) })
                            DropdownMenuItem(text = { Text("Replay audio") }, onClick = { menu = false; controller.replay() })
                            DropdownMenuItem(text = { Text(if (card.marked) "Unmark note" else "Mark note") }, onClick = { menu = false; action("mark") })
                            HorizontalDivider()
                            (1..7).forEach { f ->
                                DropdownMenuItem(
                                    leadingIcon = { Icon(Icons.Default.Flag, null, tint = FlagColors[f]) },
                                    text = { Text(if (card.flags == f) "Remove ${FlagNames[f].lowercase()} flag" else "${FlagNames[f]} flag") },
                                    onClick = { menu = false; action("flag", mapOf("flag" to f)) },
                                )
                            }
                            HorizontalDivider()
                            DropdownMenuItem(text = { Text("Bury card") }, onClick = { menu = false; action("bury", msg = "Card buried") })
                            DropdownMenuItem(text = { Text("Bury note") }, onClick = { menu = false; action("buryNote", msg = "Note buried") })
                            DropdownMenuItem(text = { Text("Suspend card") }, onClick = { menu = false; action("suspend", msg = "Card suspended") })
                            DropdownMenuItem(text = { Text("Suspend note") }, onClick = { menu = false; action("suspendNote", msg = "Note suspended") })
                            DropdownMenuItem(text = { Text("Reset (forget)") }, onClick = { menu = false; action("forget", msg = "Card reset") })
                        }
                    }
                }
                val s = state
                if (s != null) {
                    val total = s.counts.new + s.counts.learn + s.counts.review
                    val done = s.today.cards
                    LinearProgressIndicator(progress = { if (done + total == 0) 1f else done.toFloat() / (done + total) }, modifier = Modifier.fillMaxWidth().height(2.dp), color = Brand, trackColor = Color.Transparent, gapSize = 0.dp, drawStopIndicator = {})
                }
            }
        }
        error?.let { ErrorBox(it, Modifier.padding(16.dp)) }
        val s = state
        when {
            s == null -> Loading(Modifier.weight(1f))
            card == null -> Congrats(s, Modifier.weight(1f), onUnbury = { scope.launch { app.api.post<JsonObject>("/api/decks/$deckId/unbury"); load() } }, onBack = { app.pop() })
            else -> {
                val html = if (showAnswer) (answerHtml ?: card.answer) else card.question
                CardWebView(
                    html = html,
                    baseUrl = mediaBaseOf(html, app.api.server + "/"),
                    controller = controller,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    onMessage = { type -> if (type == "showAnswer") reveal() },
                    onLink = { pendingLink = it },
                )
                Surface(color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                    Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp)) {
                        if (!showAnswer) {
                            Button(
                                onClick = { reveal() },
                                modifier = Modifier.fillMaxWidth().height(54.dp),
                                shape = RoundedCornerShape(14.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = BrandDark, contentColor = Color.White),
                            ) { Text("Show answer", fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf(Triple(1, "Again", AgainColor), Triple(2, "Hard", HardColor), Triple(3, "Good", GoodColor), Triple(4, "Easy", EasyColor)).forEach { (ease, label, color) ->
                                    val info = card.buttons.firstOrNull { it.ease == ease }
                                    OutlinedButton(
                                        onClick = { answer(ease) },
                                        enabled = !busy,
                                        modifier = Modifier.weight(1f).height(58.dp),
                                        shape = RoundedCornerShape(14.dp),
                                        border = BorderStroke(1.dp, color.copy(alpha = 0.35f)),
                                        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                                    ) {
                                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                            Text(info?.label ?: "", fontSize = 11.sp, color = color.copy(alpha = 0.85f))
                                            Text(label, fontWeight = FontWeight.SemiBold, color = color, fontSize = 15.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    toast?.let { t ->
        Box(Modifier.fillMaxSize().padding(bottom = 110.dp), contentAlignment = Alignment.BottomCenter) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.inverseSurface, shadowElevation = 6.dp) {
                Text(t, Modifier.padding(horizontal = 16.dp, vertical = 10.dp), color = MaterialTheme.colorScheme.inverseOnSurface, fontSize = 14.sp)
            }
        }
    }
    pendingLink?.let { url ->
        AlertDialog(
            onDismissRequest = { pendingLink = null },
            title = { Text("Open link?") },
            text = { Text("This card links to ${try { URI(url).host } catch (e: Exception) { url }}. Open it in your browser?") },
            confirmButton = { TextButton(onClick = { openExternal(ctx, url); pendingLink = null }) { Text("Open") } },
            dismissButton = { TextButton(onClick = { pendingLink = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun Congrats(s: StudyState, modifier: Modifier, onUnbury: () -> Unit, onBack: () -> Unit) {
    Column(modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(Modifier.size(84.dp).background(Brush.linearGradient(listOf(Color(0xFF818CF8), Color(0xFF7C3AED))), RoundedCornerShape(26.dp)), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Celebration, null, Modifier.size(42.dp), tint = Color.White)
        }
        Spacer(Modifier.height(18.dp))
        Text("Congratulations!", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text("You've finished this deck for now.", color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        s.nextLearnDue?.let {
            val mins = ((it * 1000 - System.currentTimeMillis()) / 60000).coerceAtLeast(0)
            Text(if (mins < 1) "The next learning card is ready in less than a minute." else "The next learning card is ready in $mins min.", fontSize = 14.sp, modifier = Modifier.padding(top = 10.dp), textAlign = TextAlign.Center)
        }
        Text("Today: ${s.today.cards} cards in ${fmtDuration(s.today.timeMs)}", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.height(22.dp))
        if (s.buried > 0) OutlinedButton(onClick = onUnbury, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) { Text("Unbury ${s.buried} cards") }
        Button(onClick = onBack, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp), colors = ButtonDefaults.buttonColors(containerColor = BrandDark, contentColor = Color.White)) { Text("Back") }
    }
}
