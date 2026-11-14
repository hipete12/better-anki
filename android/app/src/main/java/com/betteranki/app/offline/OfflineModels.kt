package com.betteranki.app.offline

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Wire format of /api/offline/pack and /api/offline/sync (server/src/offline.ts, docs/OFFLINE.md).

@Serializable
data class PackConfig(val fsrs: Boolean, val rolloverHour: Int, val learnAheadMins: Int = 20, val timeboxMins: Int = 0)

@Serializable
data class PackDeck(val id: Long, val name: String, val configId: Long, val newLimit: Int? = null, val reviewLimit: Int? = null, val desiredRetention: Double? = null)

@Serializable
data class PackDeckToday(
    val did: Long,
    @SerialName("new_done") val newDone: Int = 0,
    @SerialName("rev_done") val revDone: Int = 0,
    @SerialName("extend_new") val extendNew: Int = 0,
    @SerialName("extend_rev") val extendRev: Int = 0,
    val ms: Long = 0,
)

/** A downloaded card: scheduling state at the base version, plus its pre-rendered pages. */
@Serializable
data class PackCard(
    val id: Long,
    val nid: Long,
    val ord: Int = 0,
    val did: Long,
    val odid: Long = 0,
    val type: Int = 0,
    val queue: Int = 0,
    val due: Long = 0,
    val odue: Long = 0,
    val ivl: Int = 0,
    val factor: Int = 0,
    val reps: Int = 0,
    val lapses: Int = 0,
    val left: Int = 0,
    val flags: Int = 0,
    val stability: Double? = null,
    val difficulty: Double? = null,
    @SerialName("last_review") val lastReview: Long? = null,
    val usn: Long = 0,
    val marked: Boolean = false,
    val question: String = "",
    val answer: String = "",
    val hasTypeAnswer: Boolean = false,
    val questionText: String = "",
) {
    fun sched() = SchedCard(id, did, odid, type, queue, due, odue, ivl, factor, reps, lapses, left, flags, stability, difficulty, lastReview)
    fun withSched(s: BaseCard) = copy(
        did = s.did, odid = s.odid, type = s.type, queue = s.queue, due = s.due, odue = s.odue, ivl = s.ivl, factor = s.factor, reps = s.reps,
        lapses = s.lapses, left = s.left, flags = s.flags, stability = s.stability, difficulty = s.difficulty, lastReview = s.lastReview,
    )
    fun base() = BaseCard(id, did, odid, type, queue, due, odue, ivl, factor, reps, lapses, left, flags, stability, difficulty, lastReview)
}

@Serializable
data class PackMedia(val name: String, val size: Long = 0)

@Serializable
data class Pack(
    val base: Long,
    val serverTime: Long,
    val tzOffsetSecs: Long,
    val today: Long,
    val days: Int = 7,
    val config: PackConfig,
    val roots: List<Long>,
    val decks: List<PackDeck>,
    val deckConfigs: List<DeckConf>,
    val deckToday: List<PackDeckToday> = emptyList(),
    val cards: List<PackCard>,
    val mediaBase: String = "",
    val media: List<PackMedia> = emptyList(),
)

/** The scheduling part of a card as the server sends it back (and as the device sends its base copy). */
@Serializable
data class BaseCard(
    val id: Long,
    val did: Long = 0,
    val odid: Long = 0,
    val type: Int = 0,
    val queue: Int = 0,
    val due: Long = 0,
    val odue: Long = 0,
    val ivl: Int = 0,
    val factor: Int = 0,
    val reps: Int = 0,
    val lapses: Int = 0,
    val left: Int = 0,
    val flags: Int = 0,
    val stability: Double? = null,
    val difficulty: Double? = null,
    @SerialName("last_review") val lastReview: Long? = null,
)

/** One thing done offline. `at` is the device clock in ms; the server corrects it. */
@Serializable
data class OfflineEvent(
    val id: String,
    val kind: String, // answer | bury | buryNote | suspend | suspendNote | flag | mark
    val cardId: Long,
    val at: Long,
    val ease: Int? = null,
    val timeMs: Long? = null,
    val flag: Int? = null,
    val marked: Boolean? = null,
)

/** Everything the device has done offline since its base, plus the id of a sync in flight (so a retry is idempotent). */
@Serializable
data class OfflineLog(val events: List<OfflineEvent> = emptyList(), val pendingSyncId: String? = null)

@Serializable
data class SyncRequest(
    val syncId: String,
    val base: Long,
    val packTime: Long,
    val deviceNow: Long,
    val events: List<OfflineEvent>,
    val baseCards: List<BaseCard>,
    val packCardIds: List<Long>,
    val resolutions: Map<String, String>? = null,
)

@Serializable
data class SyncChange(val text: String, val at: Long? = null)

@Serializable
data class SyncConflict(
    val cardId: Long,
    val question: String = "",
    val server: List<SyncChange> = emptyList(),
    val offline: List<SyncChange> = emptyList(),
    val outcomes: Map<String, String> = emptyMap(),
)

@Serializable
data class SyncDropped(val cardId: Long, val reason: String, val actions: Int = 0)

@Serializable
data class SyncResponse(
    val status: String, // ok | conflicts | preview
    val newBase: Long? = null,
    val serverTime: Long? = null,
    val cards: List<BaseCard> = emptyList(),
    val missing: List<Long> = emptyList(),
    val reviews: Int = 0,
    val touched: Int = 0,
    val autoMerged: Int = 0,
    val conflicts: List<SyncConflict> = emptyList(),
    val dropped: List<SyncDropped> = emptyList(),
    val repeated: Boolean = false,
)
