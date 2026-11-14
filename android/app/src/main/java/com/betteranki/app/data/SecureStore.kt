package com.betteranki.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Serializable
data class Credentials(
    val server: String,
    val token: String,
    val username: String? = null,
    val allowInsecure: Boolean = false,
)

/**
 * Stores the device session token encrypted with an AES-256-GCM key that lives
 * in the Android Keystore (hardware-backed where available). The key is
 * non-exportable, so the token can't be recovered from a copy of app storage
 * on another device; backups are also disabled in the manifest.
 */
class SecureStore(context: Context) {
    private val prefs = context.getSharedPreferences("secure", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return gen.generateKey()
    }

    fun save(c: Credentials) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(AAD)
        val ct = cipher.doFinal(json.encodeToString(c).toByteArray())
        prefs.edit()
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("ct", Base64.encodeToString(ct, Base64.NO_WRAP))
            .putString("lastServer", c.server)
            .apply()
    }

    fun load(): Credentials? = try {
        val iv = prefs.getString("iv", null)
        val ct = prefs.getString("ct", null)
        if (iv == null || ct == null) null else {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            cipher.updateAAD(AAD)
            json.decodeFromString<Credentials>(String(cipher.doFinal(Base64.decode(ct, Base64.NO_WRAP))))
        }
    } catch (e: Exception) {
        null
    }

    fun clear() {
        prefs.edit().remove("iv").remove("ct").apply()
    }

    fun lastServer(): String? = prefs.getString("lastServer", null)

    companion object {
        private const val ALIAS = "better-anki-session-key"
        private val AAD = "better-anki/credentials/v1".toByteArray()
    }
}

/** Decides whether traffic to a server is encrypted in transit. */
object TransportPolicy {
    data class Verdict(val secure: Boolean, val reason: String)

    fun check(url: String): Verdict {
        val u = try {
            java.net.URI(url)
        } catch (e: Exception) {
            return Verdict(false, "Invalid URL")
        }
        val host = (u.host ?: "").lowercase()
        if (u.scheme == "https") return Verdict(true, "TLS")
        if (host == "localhost" || host == "127.0.0.1" || host == "::1") return Verdict(true, "Local loopback")
        if (host == "10.0.2.2") return Verdict(true, "Emulator host loopback")
        if (host.endsWith(".ts.net")) return Verdict(true, "Tailscale (WireGuard)")
        val parts = host.split(".")
        if (parts.size == 4 && parts[0] == "100") {
            val second = parts[1].toIntOrNull() ?: -1
            if (second in 64..127) return Verdict(true, "Tailscale (WireGuard)")
        }
        return Verdict(false, "Unencrypted HTTP")
    }
}
