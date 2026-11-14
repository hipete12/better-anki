package com.betteranki.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.betteranki.app.AppState
import com.betteranki.app.Screen
import com.betteranki.app.offline.SyncChange
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

private val CHOICES = listOf("merge" to "Merge both", "offline" to "Use offline", "server" to "Keep server")

/**
 * Cards changed both offline and on the server since the download. For each, what happened on each side and
 * where the card ends up under each choice (computed by the server). Nothing is applied until "Sync".
 */
@Composable
fun SyncConflictsScreen(app: AppState) {
    val res = app.offline.conflicts
    val choices = remember { mutableStateMapOf<Long, String>() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { app.pop() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Sync conflicts", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
        }
        if (res == null || res.conflicts.isEmpty()) {
            Text("Nothing to resolve.", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Column
        }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                val n = res.conflicts.size
                Text(
                    "$n card${if (n == 1) " was" else "s were"} changed both here and on the server since you went offline. Choose what to keep." +
                        if (res.autoMerged > 0) " ${res.autoMerged} other card${if (res.autoMerged == 1) " merges" else "s merge"} automatically." else "",
                    fontSize = 14.sp, lineHeight = 20.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (res.dropped.isNotEmpty()) Text("${res.dropped.size} card${if (res.dropped.size == 1) " was" else "s were"} deleted on the server; their offline reviews will be skipped.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("All:", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.align(Alignment.CenterVertically))
                    CHOICES.forEach { (k, label) -> OutlinedButton(onClick = { res.conflicts.forEach { choices[it.cardId] = k } }, contentPadding = PaddingValues(horizontal = 10.dp), modifier = Modifier.height(34.dp), shape = RoundedCornerShape(8.dp)) { Text(label, fontSize = 12.sp) } }
                }
            }
            items(res.conflicts, key = { it.cardId }) { c ->
                Panel(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text(c.question.ifBlank { "Card ${c.cardId}" }, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        ChangeList("On the server", c.server)
                        ChangeList("Offline on this device", c.offline)
                        Spacer(Modifier.height(10.dp))
                        val chosen = choices[c.cardId] ?: "merge"
                        CHOICES.forEach { (k, label) ->
                            Row(
                                Modifier.fillMaxWidth().clickable { choices[c.cardId] = k }.padding(vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Surface(Modifier.size(18.dp), shape = RoundedCornerShape(50), color = Color.Transparent, border = BorderStroke(if (chosen == k) 5.dp else 1.5.dp, if (chosen == k) BrandDark else MaterialTheme.colorScheme.outline)) {}
                                Column(Modifier.padding(start = 12.dp)) {
                                    Text(label, fontSize = 14.sp, fontWeight = if (chosen == k) FontWeight.Medium else FontWeight.Normal)
                                    c.outcomes[k]?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                }
                            }
                        }
                    }
                }
            }
        }
        error?.let { ErrorBox(it, Modifier.padding(horizontal = 16.dp)) }
        Surface(color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
            Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp)) {
                Button(
                    enabled = !busy,
                    onClick = {
                        busy = true
                        scope.launch {
                            try {
                                val r = app.offline.sync(res.conflicts.associate { it.cardId to (choices[it.cardId] ?: "merge") })
                                when (r?.status) {
                                    "ok" -> {
                                        app.notice = "Synced ${r.reviews} offline review${if (r.reviews == 1) "" else "s"}"
                                        app.changeTick++
                                        app.pop()
                                        try { app.offline.refresh() } catch (_: Exception) {}
                                    }
                                    "conflicts" -> { choices.clear(); error = "The server changed again. Check the cards above and sync once more." }
                                    else -> error = "Nothing was synced. Try again."
                                }
                            } catch (e: Exception) { error = e.message } finally { busy = false }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = BrandDark, contentColor = Color.White),
                ) { Text(if (busy) "Syncing…" else "Sync", fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

@Composable
private fun ChangeList(title: String, changes: List<SyncChange>) {
    Text(title, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 10.dp, bottom = 2.dp))
    changes.forEach { ch ->
        Row {
            Text(ch.text, fontSize = 14.sp, modifier = Modifier.weight(1f))
            ch.at?.let { Text(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it)), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

/** A short message over any screen. */
@Composable
fun NoticeToast(app: AppState) {
    val text = app.notice ?: return
    LaunchedEffect(text) { delay(3500); if (app.notice == text) app.notice = null }
    Box(Modifier.fillMaxSize().navigationBarsPadding().padding(bottom = 96.dp, start = 16.dp, end = 16.dp), contentAlignment = Alignment.BottomCenter) {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.inverseSurface, shadowElevation = 6.dp) {
            Text(text, Modifier.padding(horizontal = 16.dp, vertical = 10.dp), color = MaterialTheme.colorScheme.inverseOnSurface, fontSize = 14.sp)
        }
    }
}

/** Offline status on the deck list: reviews waiting to sync, conflicts to resolve, download progress. */
@Composable
fun OfflineBanner(app: AppState, modifier: Modifier = Modifier) {
    val o = app.offline
    @Suppress("UNUSED_VARIABLE") val v = o.version
    val scope = rememberCoroutineScope()
    val text: String
    var action: Pair<String, () -> Unit>? = null
    when {
        o.progress != null -> text = o.progress!!
        o.conflicts != null -> { text = "Some offline reviews conflict with changes on the server."; action = "Review" to { app.push(Screen.Conflicts) } }
        o.pending > 0 -> {
            text = "${o.pending} offline action${if (o.pending == 1) "" else "s"} waiting to sync" + if (app.online) "" else " · you're offline"
            if (app.online) action = "Sync now" to { scope.launch { app.maybeSync() } }
        }
        else -> return
    }
    Panel(modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Dot(if (o.conflicts != null) appColors.hard else appColors.brand, 7)
            Text(text, Modifier.weight(1f).padding(start = 10.dp, top = 8.dp, bottom = 8.dp), fontSize = 13.sp)
            action?.let { (label, onClick) -> TextButton(onClick = onClick) { Text(label) } }
        }
    }
}

/** The downloaded decks with their offline counts, for when the server can't be reached. */
@Composable
fun OfflineDecks(app: AppState, modifier: Modifier = Modifier) {
    val e = app.offline.engine ?: return
    @Suppress("UNUSED_VARIABLE") val v = app.offline.version
    val now = System.currentTimeMillis() / 1000
    Column(modifier) {
        Text("You're offline", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        Text("Study the decks you downloaded. Your reviews sync when you're back online.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp, bottom = 10.dp))
        Panel(Modifier.fillMaxWidth()) {
            Column {
                val rows = e.pack.roots.flatMap { e.tree(it) }.distinctBy { it.id }
                rows.forEachIndexed { i, d ->
                    if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    val depth = d.name.count { it == ':' } / 2
                    val c = e.counts(d.id, now)
                    Row(Modifier.fillMaxWidth().clickable { app.push(Screen.Study(d.id, offline = true)) }.padding(start = (16 + depth * 18).dp, end = 16.dp).height(52.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(d.name.substringAfterLast("::"), Modifier.weight(1f), fontSize = 16.sp, fontWeight = if (depth == 0) FontWeight.Medium else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        CountsRow(c.new, c.learn, c.review)
                    }
                }
            }
        }
    }
}

/** Download / remove a deck for offline study, on the deck page. */
@Composable
fun DeckOfflineRow(app: AppState, deckId: Long, onError: (String) -> Unit) {
    val o = app.offline
    @Suppress("UNUSED_VARIABLE") val v = o.version
    val scope = rememberCoroutineScope()
    val e = o.engine
    val isRoot = deckId in o.roots && e?.hasDeck(deckId) == true
    val included = e?.hasDeck(deckId) == true && !isRoot
    Panel(Modifier.fillMaxWidth().padding(top = 20.dp)) {
        Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
                Text("Offline study", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                val sub = when {
                    o.progress != null -> o.progress!!
                    isRoot || included -> {
                        val n = e!!.tree(deckId).map { it.id }.toSet().let { ids -> e.pack.cards.count { it.did in ids } }
                        (if (included) "Included with a parent deck · " else "") + "$n cards downloaded for the next ${e.pack.days} days"
                    }
                    o.pending > 0 -> "Sync your offline reviews first"
                    else -> "Download this deck to study without a connection"
                }
                Text(sub, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val busy = o.progress != null
            when {
                isRoot -> TextButton(enabled = !busy && o.pending == 0, onClick = { scope.launch { try { o.download(o.roots - deckId) } catch (ex: Exception) { onError(ex.message ?: "Couldn't update offline decks") } } }) { Text("Remove") }
                !included -> TextButton(enabled = !busy && o.pending == 0 && app.online, onClick = { scope.launch { try { o.download(o.roots + deckId) } catch (ex: Exception) { onError(ex.message ?: "Download failed") } } }) { Text("Download") }
            }
        }
    }
}

/** Offline section in Settings. */
@Composable
fun OfflineSettings(app: AppState) {
    val o = app.offline
    @Suppress("UNUSED_VARIABLE") val v = o.version
    val scope = rememberCoroutineScope()
    var confirm by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val e = o.engine
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text("Offline study", fontWeight = FontWeight.SemiBold)
            if (e == null) {
                Text("No decks downloaded. Open a deck and choose Download to study it without a connection.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            } else {
                val names = e.pack.roots.mapNotNull { e.deck(it)?.name }
                val mb = o.storageBytes() / 1_000_000.0
                Text(names.joinToString(", "), fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
                Text(
                    "${e.pack.cards.size} cards · ${"%.1f".format(mb)} MB encrypted on this device · downloaded " +
                        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(o.downloadedAt)),
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (o.pending > 0) Text("${o.pending} offline action${if (o.pending == 1) "" else "s"} waiting to sync", fontSize = 12.sp, color = appColors.brand, modifier = Modifier.padding(top = 4.dp))
                error?.let { ErrorBox(it, Modifier.padding(top = 8.dp)) }
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (o.pending > 0) OutlinedButton(enabled = app.online && o.progress == null, onClick = { scope.launch { app.maybeSync() } }, shape = RoundedCornerShape(10.dp)) { Text("Sync now") }
                    else OutlinedButton(enabled = app.online && o.progress == null, onClick = { scope.launch { try { o.refresh() } catch (ex: Exception) { error = ex.message } } }, shape = RoundedCornerShape(10.dp)) { Text("Download again") }
                    TextButton(onClick = { if (o.pending > 0) confirm = true else o.removeAll() }) { Text("Remove", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        title = { Text("Discard offline reviews?") },
        text = { Text("${o.pending} offline action${if (o.pending == 1) " hasn't" else "s haven't"} synced yet. Removing offline data throws ${if (o.pending == 1) "it" else "them"} away.") },
        confirmButton = { TextButton(onClick = { confirm = false; o.discardPending(); o.removeAll() }) { Text("Discard and remove", color = Color(0xFFDC2626)) } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Keep") } },
    )
}
