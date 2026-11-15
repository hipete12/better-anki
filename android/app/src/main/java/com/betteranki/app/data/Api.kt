package com.betteranki.app.data

import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.serializer
import java.io.BufferedReader
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val status: Int, message: String) : Exception(message)

// ---------- models (subset of the server API; unknown keys ignored) ----------
@Serializable data class Health(val ok: Boolean, val name: String, val version: String, val setupRequired: Boolean, val locked: Boolean, val setupNeedsCode: Boolean, val tls: Boolean = false)
@Serializable data class AuthResult(val token: String, val username: String? = null)
@Serializable data class Counts(val new: Int, val learn: Int, val review: Int)
@Serializable data class DeckNode(val id: Long, val name: String, val shortName: String, val kind: Int, val collapsed: Boolean, val configId: Long, val counts: Counts, val total: Int, val children: List<DeckNode>)
@Serializable data class Today(val cards: Int, val timeMs: Long, val again: Int, val learn: Int = 0, val review: Int = 0, val mature: Int = 0, val matureCorrect: Int = 0)
@Serializable data class HomeCards(val total: Int, val mature: Int)
@Serializable data class TrendDay(val day: Int, val date: String, val learning: Int, val young: Int, val mature: Int)
@Serializable data class HomeSummary(val today: Today, val streak: Int, val longestStreak: Int, val retention30: Double? = null, val cards: HomeCards, val trend: List<TrendDay> = emptyList())
@Serializable data class DeckTree(val tree: List<DeckNode>, val today: Today, val currentDeckId: Long)
@Serializable data class AnswerButton(val ease: Int, val label: String, val secs: Long)
@Serializable data class CardOptions(val showTimer: Boolean = false, val capAnswerSecs: Int = 60, val autoplay: Boolean = true, val autoAdvanceQuestionSecs: Double = 0.0, val autoAdvanceAnswerSecs: Double = 0.0, val autoAdvanceAnswerAction: Int = 0)
@Serializable data class StudyCard(
    val id: Long, val nid: Long, val did: Long, val ord: Int, val type: Int, val queue: Int, val flags: Int, val marked: Boolean,
    val tags: List<String>, val deckName: String, val queueName: String, val question: String, val answer: String,
    val hasTypeAnswer: Boolean, val buttons: List<AnswerButton>, val options: CardOptions,
)
@Serializable data class UndoStatus(val label: String? = null, val available: Boolean)
@Serializable data class StudyDeck(val id: Long, val name: String, val kind: Int)
@Serializable data class Answered(val cardId: Long, val leech: Boolean, val suspended: Boolean)
@Serializable data class StudyState(
    val deck: StudyDeck, val counts: Counts, val nextLearnDue: Long? = null, val buried: Int, val undo: UndoStatus, val today: Today,
    val timeboxMins: Int = 0, val card: StudyCard? = null, val answered: Answered? = null, val undone: String? = null,
)
@Serializable data class FieldDef(val name: String, val ord: Int, val sticky: Boolean? = null, val description: String? = null)
@Serializable data class TemplateDef(val name: String, val ord: Int)
@Serializable data class Notetype(val id: Long, val name: String, val kind: Int, val fields: List<FieldDef>, val templates: List<TemplateDef>, val noteCount: Int? = null)
@Serializable data class DeckListItem(val id: Long, val name: String, val kind: Int)
@Serializable data class AddResult(val id: Long, val cards: Int)
@Serializable data class NoteCard(val id: Long, val ord: Int, val did: Long, val deck: String? = null, val template: String? = null)
@Serializable data class NoteData(val id: Long, val notetypeId: Long, val notetype: Notetype, val fields: List<String>, val tags: List<String>, val cards: List<NoteCard>)
@Serializable data class BrowseRow(
    val id: Long, val nid: Long, val sortField: String, val question: String, val answer: String, val deck: String, val notetype: String, val due: String, val ivl: String,
    val queue: Int, val flags: Int, val marked: Boolean, val tags: List<String>,
    val order: Int = 0, val state: String = "new", val layout: String = "Default", val template: String = "", val ease: String = "",
    val reps: Int = 0, val lapses: Int = 0, val created: String = "", val modified: String = "",
)
@Serializable data class BrowseResult(val total: Int, val rows: List<BrowseRow>, val ids: List<Long> = emptyList())
@Serializable data class LayoutRef(val notetypeId: Long, val name: String, val isDefault: Boolean, val cards: Int = 0)
@Serializable data class LayoutFamily(val notetypeId: Long, val notetype: String, val layouts: List<LayoutRef>)
@Serializable data class LayoutOption(val notetypeId: Long, val name: String, val isDefault: Boolean, val qfmt: String, val afmt: String, val selected: Int)
@Serializable data class LayoutOptions(val ok: Boolean, val reason: String? = null, val notetype: String = "", val cardType: String = "", val fields: List<String> = emptyList(), val options: List<LayoutOption> = emptyList())
@Serializable data class Changed(val changed: Int = 0)
@Serializable data class Duplicated(val notes: Int, val cards: Int)
@Serializable data class DeckTotals(val total: Int, val new: Int, val suspended: Int, val buried: Int, val young: Int, val mature: Int, val learning: Int)
@Serializable data class DeckLimits(val newLeft: Int, val revLeft: Int)
@Serializable data class DeckOverview(
    val counts: Counts, val buried: Int, val configName: String? = null, val deck: OverviewDeck,
    val totals: DeckTotals? = null, val limits: DeckLimits? = null, val trend: List<TrendDay> = emptyList(),
)
@Serializable data class OverviewDeck(val id: Long, val name: String, val kind: Int, val description: String = "")
@Serializable data class SessionInfo(val id: String, val device: String, val created: Long, val lastSeen: Long, val lastIp: String, val current: Boolean? = null)
@Serializable data class RetentionRow(val label: String, val young: Double? = null, val mature: Double? = null, val total: Double? = null, val count: Int)
@Serializable data class HeatDay(val day: Int, val date: String, val count: Int)
@Serializable data class ForecastDay(val day: Int, val young: Int, val mature: Int, val learn: Int)
@Serializable data class StatsSummary(val totalReviews: Int, val totalTimeMs: Long, val avgPerDay: Double, val avgSecsPerCard: Double)
@Serializable data class Stats(
    val today: Today, val counts: Map<String, Int>, val heatmap: List<HeatDay>, val streak: Int, val longestStreak: Int, val daysStudied: Int,
    val forecast: List<ForecastDay>, val dueTomorrow: Int, val overdue: Int, val avgInterval: Double, val retention: List<RetentionRow>,
    val summary: StatsSummary, val avgRetention: Double? = null, val fsrs: Boolean,
)
@Serializable data class AppConfig(val fsrs: Boolean, val rolloverHour: Int, val learnAheadMins: Int, val timeboxMins: Int, val loadBalancer: Boolean = true, val lastNotetypeId: Long = 0, val lastDeckId: Long = 1, val currentDeckId: Long = 1)

/** Minimal JSON/HTTP client. Every request carries the bearer token in a header (never in the URL). */
class Api(var server: String, var token: String?) {
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    var onUnauthorized: (() -> Unit)? = null
    /** Told whether the server answered (true) or couldn't be reached (false), to drive offline mode. */
    var onReachability: ((Boolean) -> Unit)? = null

    suspend fun <T> request(method: String, path: String, body: JsonElement?, ser: KSerializer<T>, timeoutMs: Int = 30000): T = withContext(Dispatchers.IO) {
        val conn = try {
            (URL(server.trimEnd('/') + path).openConnection() as HttpURLConnection)
        } catch (e: Exception) {
            throw ApiException(0, "Invalid server address")
        }
        try {
            conn.requestMethod = method
            conn.connectTimeout = 8000
            conn.readTimeout = timeoutMs
            conn.useCaches = false
            conn.setRequestProperty("Accept", "application/json")
            token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = conn.responseCode
            onReachability?.invoke(true)
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use(BufferedReader::readText) ?: ""
            if (code !in 200..299) {
                val msg = try {
                    json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.contentOrNull
                } catch (e: Exception) {
                    null
                } ?: "Request failed ($code)"
                if (code == 401 && token != null && !path.startsWith("/api/auth/login")) onUnauthorized?.invoke()
                throw ApiException(code, msg)
            }
            json.decodeFromString(ser, text.ifEmpty { "{}" })
        } catch (e: IOException) {
            onReachability?.invoke(false)
            throw ApiException(0, "Can't reach the server at $server")
        } finally {
            conn.disconnect()
        }
    }

    suspend inline fun <reified T> get(path: String): T = request("GET", path, null, serializer())
    suspend inline fun <reified T> post(path: String, body: JsonElement = JsonObject(emptyMap())): T = request("POST", path, body, serializer())
    suspend inline fun <reified T> put(path: String, body: JsonElement): T = request("PUT", path, body, serializer())
    suspend inline fun <reified T> delete(path: String): T = request("DELETE", path, null, serializer())

    /**
     * Server-sent change events over an authenticated streaming request.
     * Blocks (on IO) until the connection drops; invoke in a coroutine loop.
     */
    suspend fun streamEvents(onOpen: () -> Unit = {}, onChange: (List<String>) -> Unit) = withContext(Dispatchers.IO) {
        val conn = URL(server.trimEnd('/') + "/api/events").openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 8000
            conn.readTimeout = 60000
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Accept", "text/event-stream")
            if (conn.responseCode != 200) throw ApiException(conn.responseCode, "events")
            onOpen()
            val reader = conn.inputStream.bufferedReader()
            var event = ""
            while (true) {
                val line = reader.readLine() ?: break
                when {
                    line.startsWith("event: ") -> event = line.removePrefix("event: ")
                    line.startsWith("data: ") && event == "change" -> {
                        val kinds = try {
                            json.parseToJsonElement(line.removePrefix("data: ")).jsonObject["kinds"]?.let { el -> (el as kotlinx.serialization.json.JsonArray).map { it.jsonPrimitive.content } } ?: emptyList()
                        } catch (e: Exception) {
                            emptyList()
                        }
                        onChange(kinds)
                    }
                    line.isEmpty() -> event = ""
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        fun deviceName(): String = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL} (Android)"
    }
}
