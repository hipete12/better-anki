package com.betteranki.app.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.MimeTypeMap
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.material3.MaterialTheme
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Controller to talk to the card page (typed answers, audio replay). */
class CardController {
    internal var webView: WebView? = null
    fun getTyped(callback: (String?) -> Unit) {
        val wv = webView ?: return callback(null)
        wv.evaluateJavascript("(function(){try{return window.__ba&&window.__ba.getTyped();}catch(e){return null}})()") { v ->
            callback(if (v == null || v == "null") null else try { Json.parseToJsonElement(v).jsonPrimitive.content } catch (e: Exception) { null })
        }
    }
    fun replay() { webView?.evaluateJavascript("window.__ba&&window.__ba.replay()", null) }
    fun stopAudio() { webView?.evaluateJavascript("window.__ba&&window.__ba.stop()", null) }
}

/**
 * Renders server-built card pages. File/content access is disabled, nothing is
 * cached to disk (the server also sends no-store), and links open externally
 * only after user confirmation in the app.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun CardWebView(html: String, baseUrl: String, controller: CardController, modifier: Modifier = Modifier, onMessage: (String) -> Unit = {}, onLink: (String) -> Unit = {}, offlineMedia: ((String) -> ByteArray?)? = null) {
    val bg = MaterialTheme.colorScheme.background.toArgb()
    val bridge = remember { Bridge() }
    bridge.onMessage = onMessage
    bridge.onLink = onLink
    bridge.offlineMedia = offlineMedia
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            WebView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.cacheMode = WebSettings.LOAD_NO_CACHE
                settings.mediaPlaybackRequiresUserGesture = false
                settings.setSupportMultipleWindows(false)
                settings.saveFormData = false
                setBackgroundColor(bg)
                addJavascriptInterface(bridge, "BetterAnkiAndroid")
                webViewClient = object : WebViewClient() {
                    // offline: card media comes from the encrypted local copy instead of the server
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                        val media = bridge.offlineMedia ?: return null
                        val path = request.url.path ?: return null
                        val i = path.indexOf("/media/")
                        if (i < 0) return null
                        val name = request.url.lastPathSegment ?: return null
                        val bytes = media(name) ?: return WebResourceResponse("text/plain", null, 404, "Not downloaded", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
                        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
                        return WebResourceResponse(mime, null, java.io.ByteArrayInputStream(bytes))
                    }
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val url = request.url.toString()
                        if (url.startsWith("http://") || url.startsWith("https://")) bridge.onLink(url)
                        return true
                    }
                }
                controller.webView = this
            }
        },
        update = { wv ->
            controller.webView = wv
            wv.setBackgroundColor(bg)
            if (wv.tag != html) {
                wv.tag = html
                wv.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null)
            }
        },
        onRelease = { wv ->
            wv.stopLoading()
            wv.clearCache(true)
            wv.destroy()
        },
    )
}

class Bridge {
    var onMessage: (String) -> Unit = {}
    var onLink: (String) -> Unit = {}
    var offlineMedia: ((String) -> ByteArray?)? = null
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun postMessage(msg: String) {
        val type = try { Json.parseToJsonElement(msg).jsonObject["type"]?.jsonPrimitive?.content } catch (e: Exception) { null } ?: return
        if (type == "openLink") {
            val url = try { Json.parseToJsonElement(msg).jsonObject["url"]?.jsonPrimitive?.content } catch (e: Exception) { null }
            if (url != null && (url.startsWith("https://") || url.startsWith("http://"))) main.post { onLink(url) }
            return
        }
        main.post { onMessage(type) }
    }
}

fun openExternal(ctx: android.content.Context, url: String) {
    try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) {}
}
