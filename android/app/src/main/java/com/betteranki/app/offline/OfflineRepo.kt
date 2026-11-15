package com.betteranki.app.offline

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.betteranki.app.data.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID

/**
 * Offline study for the app: which decks are downloaded, the offline engine, recording actions, and syncing.
 * Compose-observable state so screens update. Rules (docs/OFFLINE.md):
 * - never re-download while actions are waiting to sync (that would move the base past them)
 * - a sync batch keeps its id until the server confirms it, so a retry after a dropped connection is idempotent
 * - no sync while an offline study session is open (it would change cards under the session)
 */
class OfflineRepo(context: Context, private val api: Api) {
    private val store = OfflineStore(context)
    private val prefs = context.getSharedPreferences("offline", Context.MODE_PRIVATE)
    private val mutex = Mutex()
    private var log = OfflineLog()

    var engine by mutableStateOf<OfflineEngine?>(null)
        private set
    /** Bumped on every change, so screens recompose. */
    var version by mutableIntStateOf(0)
        private set
    var pending by mutableIntStateOf(0)
        private set
    /** Conflicts from the last sync attempt, waiting for the user's choices. */
    var conflicts by mutableStateOf<SyncResponse?>(null)
        private set
    var progress by mutableStateOf<String?>(null)
        private set
    var lastResult by mutableStateOf<SyncResponse?>(null)
    var studying = 0

    val roots: List<Long> get() = prefs.getString("roots", "")!!.split(",").mapNotNull { it.toLongOrNull() }
    val downloadedAt: Long get() = prefs.getLong("downloadedAt", 0)

    fun load() {
        log = store.loadLog()
        engine = store.loadPack()?.let { OfflineEngine(it, log.events) }
        changed()
    }

    private fun changed() {
        pending = log.events.size
        version++
    }

    fun isAvailable(deckId: Long) = engine?.hasDeck(deckId) == true
    fun media(name: String): ByteArray? = store.getMedia(name)
    fun storageBytes() = store.packBytes() + store.mediaBytes()

    // ------------------------------------------------------------ recording (offline study)

    fun record(kind: String, cardId: Long, ease: Int? = null, timeMs: Long? = null, flag: Int? = null, marked: Boolean? = null): OfflineEngine {
        val e = engine ?: error("No offline data")
        val ev = OfflineEvent(UUID.randomUUID().toString(), kind, cardId, System.currentTimeMillis(), ease, timeMs, flag, marked)
        e.record(ev)
        log = log.copy(events = log.events + ev)
        store.saveLog(log)
        changed()
        return e
    }

    /** Undo the last offline action (not one that's part of a sync in flight). Returns its kind. */
    fun undo(): String? {
        val p = engine?.pack ?: return null
        val last = log.events.lastOrNull() ?: return null
        if (log.pendingSyncId != null && log.events.size <= log.pendingCount) return null
        log = log.copy(events = log.events.dropLast(1))
        store.saveLog(log)
        engine = OfflineEngine(p, log.events)
        changed()
        return last.kind
    }
    fun canUndo() = log.events.isNotEmpty() && !(log.pendingSyncId != null && log.events.size <= log.pendingCount)

    // ------------------------------------------------------------ download

    /** Download the given decks for offline study (replacing what's there). Only when nothing waits to sync. */
    suspend fun download(deckIds: List<Long>, days: Int = 7) = mutex.withLock {
        check(log.events.isEmpty()) { "Sync your offline reviews before downloading again" }
        if (deckIds.isEmpty()) {
            removeAll()
            return@withLock
        }
        progress = "Downloading cards…"
        try {
            val body = buildJsonObject {
                putJsonArray("deckIds") { deckIds.forEach { add(it) } }
                put("days", days)
                put("platform", "android")
            }
            val pack = api.request("POST", "/api/offline/pack", body, Pack.serializer(), timeoutMs = 180_000)
            val missing = pack.media.filter { !store.hasMedia(it.name) }
            missing.forEachIndexed { i, m ->
                progress = "Downloading media ${i + 1} of ${missing.size}…"
                fetch(pack.mediaBase + URLEncoder.encode(m.name, "UTF-8").replace("+", "%20"))?.let { store.putMedia(m.name, it) }
            }
            store.pruneMedia(pack.media.map { it.name })
            store.savePack(pack)
            log = OfflineLog()
            store.saveLog(log)
            prefs.edit().putString("roots", deckIds.joinToString(",")).putLong("downloadedAt", System.currentTimeMillis()).apply()
            engine = OfflineEngine(pack, emptyList())
            changed()
        } finally {
            progress = null
        }
    }

    /** Re-download the same decks (fresh due cards and pages). Skipped when actions are waiting to sync. */
    suspend fun refresh() {
        if (roots.isNotEmpty() && log.events.isEmpty() && studying == 0) download(roots)
    }

    private suspend fun fetch(url: String): ByteArray? = withContext(Dispatchers.IO) {
        try {
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 8000
            c.readTimeout = 60000
            try {
                if (c.responseCode == 200) c.inputStream.use { it.readBytes() } else null
            } finally {
                c.disconnect()
            }
        } catch (_: Exception) {
            null
        }
    }

    fun removeAll() {
        check(log.events.isEmpty()) { "Sync your offline reviews before removing offline data" }
        store.clear()
        prefs.edit().remove("roots").remove("downloadedAt").apply()
        log = OfflineLog()
        engine = null
        conflicts = null
        changed()
    }

    /** Throw away offline actions that can't be synced (the user chose to). */
    fun discardPending() {
        log = OfflineLog()
        store.saveLog(log)
        engine = engine?.pack?.let { OfflineEngine(it, emptyList()) }
        conflicts = null
        changed()
    }

    // ------------------------------------------------------------ sync

    /**
     * Send offline actions to the server. Returns the server's answer: "ok" (applied; the pack is updated and the
     * log cleared), "conflicts" (nothing applied; see [conflicts]), or null when there was nothing to do.
     */
    suspend fun sync(resolutions: Map<Long, String>? = null): SyncResponse? = mutex.withLock {
        val e = engine ?: return@withLock null
        if (log.events.isEmpty() || studying > 0) return@withLock null
        if (log.pendingSyncId == null) {
            log = log.copy(pendingSyncId = UUID.randomUUID().toString(), pendingCount = log.events.size)
            store.saveLog(log)
        }
        val batch = log.events.take(log.pendingCount)
        val pack = e.pack
        val touched = batch.map { it.cardId }.toSet()
        val req = SyncRequest(
            syncId = log.pendingSyncId!!,
            base = pack.base,
            packTime = pack.serverTime,
            deviceNow = System.currentTimeMillis(),
            events = batch,
            baseCards = pack.cards.filter { it.id in touched }.map { it.base() },
            packCardIds = pack.cards.map { it.id },
            resolutions = resolutions?.mapKeys { it.key.toString() },
        )
        progress = "Syncing…"
        try {
            val res = api.request("POST", "/api/offline/sync", api.json.encodeToJsonElement(SyncRequest.serializer(), req), SyncResponse.serializer(), timeoutMs = 120_000)
            when (res.status) {
                "ok" -> {
                    // bring the pack up to date: the server's state for changed cards, deleted cards gone, new base
                    val changedCards = res.cards.associateBy { it.id }
                    val gone = res.missing.toSet()
                    val rest = log.events.drop(log.pendingCount)
                    val synced = OfflineEngine(pack, batch) // today's counts including the synced batch, not later actions
                    val updated = pack.copy(
                        base = res.newBase ?: pack.base,
                        // serverTime stays the download time: it's the lower bound for review times, and actions still
                        // in the log (recorded before this sync) must keep their real times
                        cards = pack.cards.filter { it.id !in gone }.map { c -> changedCards[c.id]?.let { c.withSched(it) } ?: c },
                        today = synced.currentDay,
                        deckToday = synced.todayCounts(),
                    )
                    store.savePack(updated)
                    log = OfflineLog(events = rest)
                    store.saveLog(log)
                    engine = OfflineEngine(updated, rest)
                    conflicts = null
                    lastResult = res
                    changed()
                }
                "conflicts" -> conflicts = res
            }
            res
        } finally {
            progress = null
        }
    }
}
