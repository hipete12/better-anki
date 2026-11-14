package com.betteranki.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
import com.betteranki.app.ui.BetterAnkiTheme
import com.betteranki.app.ui.ConnectScreen
import com.betteranki.app.ui.DeckOverviewScreen
import com.betteranki.app.ui.EditNoteScreen
import com.betteranki.app.ui.HomeScreen
import com.betteranki.app.ui.StudyScreen
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException

sealed class Screen {
    data class Home(val tab: Int = 0) : Screen()
    data class Deck(val id: Long) : Screen()
    data class Study(val id: Long) : Screen()
    data class EditNote(val nid: Long) : Screen()
}

class AppState : ViewModel() {
    var creds by mutableStateOf<Credentials?>(null)
        private set
    var loaded by mutableStateOf(false)
    val api = Api("", null)
    val stack = mutableStateListOf<Screen>(Screen.Home())
    /** Bumped whenever the server reports a change; screens reload on change. */
    var changeTick by mutableIntStateOf(0)
    private lateinit var store: SecureStore
    private var events: Job? = null

    fun init(store: SecureStore) {
        if (loaded) return
        this.store = store
        store.load()?.let { setCreds(it, persist = false) }
        api.onUnauthorized = { viewModelScope.launch { signOut(local = true) } }
        loaded = true
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
                    api.streamEvents { changeTick++ }
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
        api.token = null
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
        setContent {
            BetterAnkiTheme {
                val app: AppState = viewModel()
                LaunchedEffect(Unit) { app.init(store) }
                if (app.loaded) Root(app)
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
        is Screen.Home -> HomeScreen(app, top.tab)
        is Screen.Deck -> DeckOverviewScreen(app, top.id)
        is Screen.Study -> StudyScreen(app, top.id)
        is Screen.EditNote -> EditNoteScreen(app, top.nid)
    }
}
