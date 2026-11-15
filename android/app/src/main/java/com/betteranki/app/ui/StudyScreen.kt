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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.betteranki.app.AppState
import com.betteranki.app.Screen
import com.betteranki.app.data.StudyState
import com.betteranki.app.data.StudyCard
import com.betteranki.app.data.StudyDeck
import com.betteranki.app.data.AnswerButton
import com.betteranki.app.data.CardOptions
import com.betteranki.app.data.Counts
import com.betteranki.app.data.Today
import com.betteranki.app.data.UndoStatus
import com.betteranki.app.data.ApiException
import com.betteranki.app.offline.intervalLabel
import androidx.compose.runtime.DisposableEffect
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URI

private fun mediaBaseOf(html: String, fallback: String): String =
    Regex("<base href=\"([^\"]+)\"").find(html)?.groupValues?.get(1)?.replace("&amp;", "&") ?: fallback

@Composable
fun StudyScreen(app: AppState, deckId: Long, startOffline: Boolean = false) {
    val dark = LocalDark.current
    // offline: study from the downloaded copy; actions are logged and synced later (docs/OFFLINE.md)
    var offline by remember { mutableStateOf(startOffline) }
    DisposableEffect(offline) {
        val active = offline // the value for this effect; `offline` itself may have changed by the time it's disposed
        if (active) app.offline.studying++
        onDispose { if (active) { app.offline.studying--; app.syncSoon() } }
    }
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
    fun night(html: String) = html.replace("__BA_NIGHT_HTML__", if (dark) "night-mode" else "").replace("__BA_NIGHT_CARD__", if (dark) "nightMode night_mode" else "")
    /** The same study state the server would send, built from the offline engine. */
    fun offlineState(): StudyState? {
        val e = app.offline.engine ?: return null
        val now = System.currentTimeMillis() / 1000
        val n = e.next(deckId, now)
        val (count, ms, again) = e.today(now)
        val card = n.card?.let { c ->
            val pc = e.content(c.id)!!
            val outs = e.outcomes(c.id, now)
            val conf = e.context(c, now).conf
            StudyCard(
                id = c.id, nid = pc.nid, did = c.did, ord = pc.ord, type = c.type, queue = c.queue, flags = c.flags and 7, marked = e.isMarked(c.id),
                tags = emptyList(), deckName = e.deck(c.did)?.name ?: "", queueName = n.queueName ?: "new", question = night(pc.question), answer = night(pc.answer),
                hasTypeAnswer = false, buttons = (1..4).map { r -> AnswerButton(r, intervalLabel(outs.getValue(r).dueInSecs), outs.getValue(r).dueInSecs) },
                options = CardOptions(showTimer = conf.showTimer, capAnswerSecs = conf.capAnswerSecs, autoplay = !conf.disableAutoplay, autoAdvanceQuestionSecs = conf.autoAdvanceQuestionSecs, autoAdvanceAnswerSecs = conf.autoAdvanceAnswerSecs, autoAdvanceAnswerAction = conf.autoAdvanceAnswerAction),
            )
        }
        return StudyState(
            deck = StudyDeck(deckId, e.deck(deckId)?.name ?: "", 0), counts = Counts(n.counts.new, n.counts.learn, n.counts.review), nextLearnDue = n.nextLearnDue,
            buried = n.buried, undo = UndoStatus(null, app.offline.canUndo()), today = Today(count, ms, again), card = card,
        )
    }
    fun goOffline(): Boolean {
        if (!app.offline.isAvailable(deckId)) return false
        offline = true
        error = null
        offlineState()?.let { apply(it) }
        return true
    }
    suspend fun load() {
        if (offline) { offlineState()?.let { apply(it) }; return }
        try { apply(app.api.get<StudyState>("/api/study/$deckId$q")); error = null } catch (e: Exception) {
            if (!(e is ApiException && e.status == 0 && goOffline())) error = e.message
        }
    }
    LaunchedEffect(deckId, dark) { load() }
    // when only a learning card is left, show it as soon as it's due
    LaunchedEffect(state?.nextLearnDue, state?.card == null) {
        val due = state?.nextLearnDue ?: return@LaunchedEffect
        if (state?.card != null) return@LaunchedEffect
        delay((due * 1000 - System.currentTimeMillis()).coerceAtLeast(0) + 500)
        load()
    }
    LaunchedEffect(toast) { if (toast != null) { delay(2500); toast = null } }

    val card = state?.card
    fun reveal() {
        val c = card ?: return
        if (showAnswer) return
        if (c.hasTypeAnswer && !offline) {
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
    fun answerOffline(cardId: Long, ease: Int, timeMs: Long) {
        val e = app.offline.record("answer", cardId, ease = ease, timeMs = timeMs)
        e.lastLeech?.let { toast = if (it) "Leech: card suspended" else "Leech: card tagged" }
        offlineState()?.let { apply(it) }
    }
    fun answer(ease: Int) {
        val c = card ?: return
        if (busy || !showAnswer) return
        val timeMs = System.currentTimeMillis() - shownAt
        if (offline) return answerOffline(c.id, ease, timeMs)
        busy = true
        scope.launch {
            try {
                val s = app.api.post<StudyState>("/api/study/$deckId/answer$q", buildJsonObject { put("cardId", c.id); put("ease", ease); put("timeMs", timeMs) })
                if (s.answered?.leech == true) toast = if (s.answered.suspended) "Leech: card suspended" else "Leech: card tagged"
                apply(s)
            } catch (e: Exception) {
                // lost the connection mid-session: keep going from the downloaded copy if this card is in it
                if (e is ApiException && e.status == 0 && app.offline.engine?.card(c.id) != null && app.offline.isAvailable(deckId)) {
                    offline = true
                    toast = "You're offline. Reviews will sync later."
                    answerOffline(c.id, ease, timeMs)
                } else toast = e.message
            } finally { busy = false }
        }
    }
    fun undo() = scope.launch {
        if (offline) {
            val kind = app.offline.undo()
            toast = when (kind) { null -> "Nothing to undo"; "answer" -> "Undid review"; else -> "Undid $kind" }
            offlineState()?.let { apply(it) }
            return@launch
        }
        try { val s = app.api.post<StudyState>("/api/study/$deckId/undo$q"); s.undone?.let { toast = "Undid $it" }; apply(s) } catch (e: Exception) { toast = e.message }
    }
    fun action(act: String, extra: Map<String, Int> = emptyMap(), msg: String? = null) = scope.launch {
        val c = card ?: return@launch
        if (offline) {
            when (act) {
                "bury", "buryNote", "suspend", "suspendNote" -> app.offline.record(act, c.id)
                "flag" -> app.offline.record("flag", c.id, flag = if (c.flags == extra["flag"]) 0 else extra["flag"] ?: 0)
                "mark" -> app.offline.record("mark", c.id, marked = !c.marked)
                else -> { toast = "That needs a connection"; return@launch }
            }
            msg?.let { toast = it }
            val e = app.offline.engine ?: return@launch
            if (act == "flag" || act == "mark") state = state?.copy(card = c.copy(flags = (e.card(c.id)?.flags ?: 0) and 7, marked = e.isMarked(c.id)), undo = UndoStatus(null, app.offline.canUndo()))
            else offlineState()?.let { apply(it) }
            return@launch
        }
        try {
            val s = app.api.post<StudyState>("/api/study/$deckId/action$q", buildJsonObject { put("cardId", c.id); put("action", act); extra.forEach { (k, v) -> put(k, v) } })
            msg?.let { toast = it }
            if (act == "flag" || act == "mark") state = state?.copy(card = state?.card?.copy(flags = s.card?.flags ?: 0, marked = s.card?.marked ?: false), undo = s.undo)
            else apply(s)
        } catch (e: Exception) { toast = e.message }
    }

    // gestures, volume buttons and keys (Settings → Gestures and keys)
    val controls = LocalStudyControls.current
    var typing by remember { mutableStateOf(false) } // the typed-answer box has focus: keys are for it
    LaunchedEffect(card?.id, showAnswer) { typing = false }
    fun run(a: StudyAction): Boolean {
        val c = card
        when {
            a == StudyAction.NONE -> return false
            a == StudyAction.UNDO -> if (state?.undo?.available == true) undo() else toast = "Nothing to undo"
            a == StudyAction.EXIT -> app.pop()
            c == null -> return false
            a == StudyAction.SHOW_ANSWER -> reveal()
            a.ease > 0 -> if (showAnswer) answer(a.ease) else reveal()
            a.flag > 0 -> action("flag", mapOf("flag" to a.flag))
            a == StudyAction.EDIT -> if (offline) toast = "That needs a connection" else app.push(Screen.EditNote(c.nid))
            a == StudyAction.MARK -> action("mark")
            a == StudyAction.BURY_CARD -> action("bury", msg = "Card buried")
            a == StudyAction.BURY_NOTE -> action("buryNote", msg = "Note buried")
            a == StudyAction.SUSPEND_CARD -> action("suspend", msg = "Card suspended")
            a == StudyAction.SUSPEND_NOTE -> action("suspendNote", msg = "Note suspended")
            a == StudyAction.REPLAY -> controller.replay()
        }
        return true
    }
    // a single tap waits briefly when double tap does something, so a double tap doesn't also run the tap's action
    var pendingTap by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    fun gesture(g: StudyGesture) {
        val a = controls[g]
        if (g == StudyGesture.DOUBLE_TAP) { pendingTap?.cancel(); pendingTap = null; run(a); return }
        if (a == StudyAction.NONE) return
        if (g.name.startsWith("TAP_") && controls[StudyGesture.DOUBLE_TAP] != StudyAction.NONE) {
            pendingTap?.cancel()
            pendingTap = scope.launch { delay(330); pendingTap = null; run(a) }
        } else run(a)
    }
    fun onCardMessage(type: String) {
        when {
            type == "showAnswer" -> reveal()
            type == "doubleTap" -> gesture(StudyGesture.DOUBLE_TAP)
            type.startsWith("tap:") -> type.removePrefix("tap:").toIntOrNull()?.let(StudyGesture::tap)?.let(::gesture)
            type.startsWith("swipe:") -> StudyGesture.swipe(type.removePrefix("swipe:"))?.let(::gesture)
            type == "inputFocus" -> typing = true
            type == "inputBlur" -> typing = false
        }
    }
    val onKey by rememberUpdatedState { e: android.view.KeyEvent ->
        val volume = when (e.keyCode) { android.view.KeyEvent.KEYCODE_VOLUME_UP -> StudyGesture.VOLUME_UP; android.view.KeyEvent.KEYCODE_VOLUME_DOWN -> StudyGesture.VOLUME_DOWN; else -> null }
        when {
            volume != null -> if (controls[volume] == StudyAction.NONE || (card == null && controls[volume] != StudyAction.UNDO && controls[volume] != StudyAction.EXIT)) false else {
                // set to an action: the button no longer changes the volume here
                if (e.action == android.view.KeyEvent.ACTION_DOWN && e.repeatCount == 0) run(controls[volume])
                true
            }
            e.action != android.view.KeyEvent.ACTION_DOWN || typing || menu -> false
            else -> keyAction(e, showAnswer)?.let { a -> if (e.repeatCount == 0) run(a); true } ?: false
        }
    }
    DisposableEffect(Unit) {
        app.keyHandler = { onKey(it) }
        onDispose { app.keyHandler = null; pendingTap?.cancel() }
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
                            if (!offline) DropdownMenuItem(text = { Text("Edit note") }, onClick = { menu = false; app.push(Screen.EditNote(card.nid)) })
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
                            if (!offline) DropdownMenuItem(text = { Text("Reset (forget)") }, onClick = { menu = false; action("forget", msg = "Card reset") })
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
        if (offline) {
            val pending = app.offline.pending
            Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                Text(
                    "Offline · " + if (pending == 0) "reviews sync when you're back online" else "$pending review${if (pending == 1) "" else "s"} will sync when you're back online",
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        error?.let { ErrorBox(it, Modifier.padding(16.dp)) }
        val s = state
        when {
            s == null -> Loading(Modifier.weight(1f))
            card == null -> Congrats(if (offline) s.copy(buried = 0) else s, Modifier.weight(1f), onUnbury = { scope.launch { app.api.post<JsonObject>("/api/decks/$deckId/unbury"); load() } }, onBack = { app.pop() })
            else -> {
                val html = if (showAnswer) (answerHtml ?: card.answer) else card.question
                CardWebView(
                    html = html,
                    baseUrl = mediaBaseOf(html, app.api.server + "/"),
                    controller = controller,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    onMessage = { onCardMessage(it) },
                    onLink = { pendingLink = it },
                    offlineMedia = if (offline) app.offline::media else null,
                )
                Surface(color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                    Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp)) {
                        if (!showAnswer) {
                            Button(
                                onClick = { reveal() },
                                modifier = Modifier.fillMaxWidth().height(50.dp),
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = BrandDark, contentColor = Color.White),
                            ) { Text("Show answer", fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                val ac = appColors
                                listOf(Triple(1, "Again", ac.again), Triple(2, "Hard", ac.hard), Triple(3, "Good", ac.good), Triple(4, "Easy", ac.easy)).forEach { (ease, label, color) ->
                                    val info = card.buttons.firstOrNull { it.ease == ease }
                                    OutlinedButton(
                                        onClick = { answer(ease) },
                                        enabled = !busy,
                                        modifier = Modifier.weight(1f).height(56.dp),
                                        shape = RoundedCornerShape(10.dp),
                                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                                        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                                    ) {
                                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                            Text(label, fontWeight = FontWeight.SemiBold, color = color, fontSize = 15.sp)
                                            Text(info?.label ?: "", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    val ac = appColors
    val t = s.today
    Column(modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("All done", fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
        Text("You've finished this deck for now.", color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, fontSize = 14.sp)
        Spacer(Modifier.height(24.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
            Stat("${t.cards}", "today", color = ac.brand)
            Stat(fmtDuration(t.timeMs), "time")
            Stat(if (t.cards > 0) "${(100 * (t.cards - t.again)) / t.cards}%" else "–", "correct", color = if (t.cards > 0) ac.due else ac.faint)
        }
        s.nextLearnDue?.let {
            val mins = ((it * 1000 - System.currentTimeMillis()) / 60000).coerceAtLeast(0)
            Text(if (mins < 1) "The next learning card is ready in less than a minute." else "The next learning card is ready in $mins min.", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 20.dp), textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(28.dp))
        Button(onClick = onBack, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth().height(48.dp), colors = ButtonDefaults.buttonColors(containerColor = BrandDark, contentColor = Color.White)) { Text("Back to decks") }
        if (s.buried > 0) OutlinedButton(onClick = onUnbury, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text("Unbury ${s.buried} cards") }
    }
}
