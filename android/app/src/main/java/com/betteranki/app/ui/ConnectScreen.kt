package com.betteranki.app.ui

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.betteranki.app.AppState
import com.betteranki.app.R
import com.betteranki.app.data.Api
import com.betteranki.app.data.AuthResult
import com.betteranki.app.data.Credentials
import com.betteranki.app.data.Health
import com.betteranki.app.data.TransportPolicy
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable
fun ConnectScreen(app: AppState) {
    var server by remember { mutableStateOf(app.lastServer() ?: "http://10.0.2.2:8765") }
    var health by remember { mutableStateOf<Health?>(null) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var password2 by remember { mutableStateOf("") }
    var setupCode by remember { mutableStateOf("") }
    var allowInsecure by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val url = server.trim().trimEnd('/').let { if (it.startsWith("http://") || it.startsWith("https://")) it else "http://$it" }
    val transport = TransportPolicy.check(url)

    fun check() = scope.launch {
        error = null
        if (!transport.secure && !allowInsecure) {
            health = null
            error = "This address isn't encrypted in transit. Use HTTPS or your Tailscale address (100.x.y.z / *.ts.net), or allow insecure connections."
            return@launch
        }
        busy = true
        try {
            val h = Api(url, null).get<Health>("/api/health")
            if (h.name != "Better Anki") throw Exception("Not a Better Anki server")
            health = h
        } catch (e: Exception) {
            health = null
            error = e.message
        } finally {
            busy = false
        }
    }
    LaunchedEffect(Unit) { check() }

    fun submit() = scope.launch {
        val h = health ?: return@launch
        error = null
        if (h.setupRequired && password != password2) {
            error = "Passwords don't match"; return@launch
        }
        busy = true
        try {
            val body = buildJsonObject {
                put("username", username.ifBlank { if (h.setupRequired) "owner" else "" })
                put("password", password)
                put("device", Api.deviceName())
                if (setupCode.isNotBlank()) put("setupCode", setupCode.trim())
            }
            val res = Api(url, null).post<AuthResult>(if (h.setupRequired) "/api/auth/setup" else "/api/auth/login", body)
            app.setCreds(Credentials(url, res.token, res.username, allowInsecure))
        } catch (e: Exception) {
            error = e.message
        } finally {
            busy = false
        }
    }

    Box(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            Modifier.systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp).widthIn(max = 480.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(24.dp))
            Box(Modifier.size(56.dp).background(BrandDark, RoundedCornerShape(14.dp))) {
                Image(painterResource(R.drawable.ic_launcher_foreground), null, Modifier.fillMaxSize())
            }
            Spacer(Modifier.height(14.dp))
            Text("Better Anki", fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Text("Spaced repetition, on your own encrypted server.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
            Spacer(Modifier.height(24.dp))
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(server, { server = it; health = null }, label = { Text("Server") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), shape = RoundedCornerShape(12.dp))
                        OutlinedButton(onClick = { check() }, shape = RoundedCornerShape(12.dp), modifier = Modifier.height(56.dp)) { Text("Connect") }
                    }
                    InfoBox(
                        if (transport.secure) "Connection encrypted in transit (${transport.reason}). Your collection is AES-256 encrypted at rest on the server; this device stores its key in the Android Keystore."
                        else "Plain HTTP to this address is not encrypted. Prefer HTTPS or your Tailscale address.",
                        transport.secure,
                    )
                    if (!transport.secure) Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(allowInsecure, { allowInsecure = it })
                        Text("Allow insecure connection", fontSize = 14.sp)
                    }
                    health?.let { h ->
                        if (h.setupRequired) {
                            Text("Create your account", fontWeight = FontWeight.SemiBold)
                            Text("Your password protects the key that encrypts your collection. It can't be recovered if forgotten.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else if (h.locked) Text("Server is locked. Signing in unlocks your encrypted collection.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        OutlinedTextField(username, { username = it }, label = { Text("Username") }, singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
                        OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = if (h.setupRequired) ImeAction.Next else ImeAction.Done), keyboardActions = KeyboardActions(onDone = { if (!busy) submit() }), modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
                        if (h.setupRequired) OutlinedTextField(password2, { password2 = it }, label = { Text("Confirm password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = if (h.setupNeedsCode) ImeAction.Next else ImeAction.Done), keyboardActions = KeyboardActions(onDone = { if (!busy) submit() }), modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
                        if (h.setupRequired && h.setupNeedsCode) OutlinedTextField(setupCode, { setupCode = it.uppercase() }, label = { Text("Setup code (from server console)") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
                    }
                    error?.let { ErrorBox(it) }
                    Button(
                        onClick = { if (health == null) check() else submit() },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = BrandDark, contentColor = androidx.compose.ui.graphics.Color.White),
                    ) {
                        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = androidx.compose.ui.graphics.Color.White)
                        else Text(if (health?.setupRequired == true) "Create account" else if (health == null) "Connect" else "Sign in", fontSize = 16.sp)
                    }
                }
            }
            health?.let { Text("Server v${it.version}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp)) }
        }
    }
}
