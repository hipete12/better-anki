package com.betteranki.app

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.betteranki.app.data.Api
import com.betteranki.app.data.Credentials
import com.betteranki.app.data.SecureStore
import com.betteranki.app.ui.Appearance
import com.betteranki.app.ui.BetterAnkiTheme
import com.betteranki.app.ui.LocalAppearance
import com.betteranki.app.ui.ThemeChoice
import com.betteranki.app.ui.ConnectScreen
import com.betteranki.app.ui.DeckOverviewScreen
import com.betteranki.app.ui.EditNoteScreen
import com.betteranki.app.ui.HomeScreen
import com.betteranki.app.ui.StudyScreen
import com.betteranki.app.ui.SyncConflictsScreen
import com.betteranki.app.ui.NoticeToast
import com.betteranki.app.offline.OfflineRepo
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException

sealed class Screen {
    /** `query`: a search to open Browse with; `deckId`: the deck to add cards to. */
    data class Home(val tab: Int = 0, val query: String? = null, val deckId: Long? = null) : Screen()
    data class Deck(val id: Long) : Screen()
    /** `offline`: study from the downloaded copy (no server needed). */
    data class Study(val id: Long, val offline: Boolean = false) : Screen()
    data object Conflicts : Screen()
    data class EditNote(val nid: Long) : Screen()
    /** Choose or create the front/back layout for these cards. */
    data class DisplayOrder(val cardIds: List<Long>) : Screen()
    data class DeckOptions(val id: Long) : Screen()
}

class AppState : ViewModel() {
    var creds by mutableStateOf<Credentials?>(null)
        private set
    var loaded by mutableStateOf(false)
    val api = Api("", null)
    val stack = mutableStateListOf<Screen>(Screen.Home())
    /** Browse's search, sort, scroll and selection, kept while other screens are open. */
    val browse = com.betteranki.app.ui.BrowseState()
    /** Bumped whenever the server reports a change; screens reload on change. */
    var changeTick by mutableIntStateOf(0)
    /** Whether the server was reachable on the last request. */
    var online by mutableStateOf(true)
        private set
    /** A short message shown over any screen (e.g. "Synced 12 offline reviews"). */
    var notice by mutableStateOf<String?>(null)
    lateinit var offline: OfflineRepo
        private set
    private lateinit var store: SecureStore
    private var events: Job? = null
    private var syncJob: Job? = null

    fun init(store: SecureStore, context: Context) {
        if (loaded) return
        this.store = store
        offline = OfflineRepo(context, api).also { it.load() }
        api.onReachability = { ok -> if (ok != online) viewModelScope.launch { online = ok; if (ok) maybeSync() } }
        store.load()?.let { setCreds(it, persist = false) }
        api.onUnauthorized = { viewModelScope.launch { signOut(local = true) } }
        syncJob = viewModelScope.launch {
            delay(1500)
            while (isActive) {
                maybeSync()
                delay(20_000)
            }
        }
        loaded = true
    }

    fun syncSoon() { viewModelScope.launch { delay(300); maybeSync() } }

    private var syncing = false
    /** Send offline reviews when the server is reachable and no offline session is open; keep the download fresh. */
    suspend fun maybeSync() {
        if (creds == null || syncing) return
        syncing = true
        try {
            if (offline.pending > 0 && offline.studying == 0 && offline.conflicts == null) {
                val r = offline.sync()
                when (r?.status) {
                    "ok" -> {
                        val n = r.reviews
                        notice = if (r.dropped.isNotEmpty()) "Synced $n offline reviews · ${r.dropped.size} deleted cards skipped" else "Synced $n offline review${if (n == 1) "" else "s"}"
                        changeTick++
                        try { offline.refresh() } catch (_: Exception) {}
                    }
                    "conflicts" -> notice = "Some offline reviews conflict with changes on the server"
                }
            } else if (offline.pending == 0 && offline.roots.isNotEmpty() && System.currentTimeMillis() - offline.downloadedAt > 6 * 3600_000L) {
                offline.refresh()
            }
        } catch (_: Exception) {
        } finally {
            syncing = false
        }
    }

    fun lastServer() = store.lastServer()

    fun setCreds(c: Credentials, persist: Boolean = true) {
        if (persist) store.save(c)
        api.server = c.server
        api.token = c.token
        creds = c
        startEvents()
    }

    private fun startEvents() {
        events?.cancel()
        events = viewModelScope.launch {
            while (isActive) {
                try {
                    api.streamEvents(onOpen = { viewModelScope.launch { online = true; maybeSync() } }) { changeTick++ }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                }
                delay(4000)
            }
        }
    }

    suspend fun signOut(local: Boolean = false) {
        if (!local) try { api.post<kotlinx.serialization.json.JsonObject>("/api/auth/logout") } catch (_: Exception) {}
        events?.cancel()
        store.clear()
        // offline data holds collection content: it goes with the session
        offline.discardPending()
        offline.removeAll()
        api.token = null
        browse.clear()
        creds = null
        stack.clear()
        stack.add(Screen.Home())
    }

    fun push(s: Screen) { stack.add(s) }
    fun pop() { if (stack.size > 1) stack.removeAt(stack.lastIndex) }
    fun replaceTop(s: Screen) { stack[stack.lastIndex] = s }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val store = SecureStore(applicationContext)
        val appearance = Appearance(applicationContext)
        setContent {
            val dark = when (appearance.theme) { ThemeChoice.System -> isSystemInDarkTheme(); ThemeChoice.Light -> false; ThemeChoice.Dark -> true }
            // status and navigation bar icons follow the app's theme, not just the system's
            DisposableEffect(dark) {
                val bars = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT) else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
                onDispose {}
            }
            CompositionLocalProvider(LocalAppearance provides appearance) {
                BetterAnkiTheme(dark, appearance.font.family) {
                    val app: AppState = viewModel()
                    LaunchedEffect(Unit) { app.init(store, applicationContext) }
                    // a Surface so every screen gets the theme's text color (screens outside the tab Scaffold drew black text in dark mode)
                    androidx.compose.material3.Surface(color = androidx.compose.material3.MaterialTheme.colorScheme.background) {
                        if (app.loaded) Root(app)
                    }
                }
            }
        }
    }
}

@Composable
fun Root(app: AppState) {
    if (app.creds == null) {
        ConnectScreen(app)
        return
    }
    val top = app.stack.last()
    BackHandler(enabled = app.stack.size > 1) { app.pop() }
    when (top) {
        is Screen.Home -> HomeScreen(app, top)
        is Screen.Deck -> DeckOverviewScreen(app, top.id)
        is Screen.Study -> StudyScreen(app, top.id, top.offline)
        is Screen.EditNote -> EditNoteScreen(app, top.nid)
        is Screen.Conflicts -> SyncConflictsScreen(app)
        is Screen.DisplayOrder -> com.betteranki.app.ui.DisplayOrderScreen(app, top.cardIds)
        is Screen.DeckOptions -> com.betteranki.app.ui.DeckOptionsScreen(app, top.id)
    }
    NoticeToast(app)
}
