package com.betteranki.app.offline

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import kotlinx.serialization.json.Json
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Encrypted on-device storage for offline study: the downloaded pack, the action log and media files.
 * Envelope encryption: a random AES-256 data key (fast for multi-megabyte packs) wrapped by a non-exportable
 * Android Keystore key, the same protection as the session token. Media files are named by a hash of their
 * name, and the name is bound to the ciphertext, so file names don't leak.
 */
class OfflineStore(context: Context) {
    private val dir = File(context.filesDir, "offline").apply { mkdirs() }
    private val mediaDir = File(dir, "media").apply { mkdirs() }
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    private val random = SecureRandom()
    private val dek: SecretKey by lazy { loadOrCreateDataKey() }

    // ------------------------------------------------------------ keys

    private fun keystoreKey(): SecretKey {
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

    private fun loadOrCreateDataKey(): SecretKey {
        val f = File(dir, "key.bin")
        if (f.exists()) {
            try {
                val data = f.readBytes()
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, keystoreKey(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
                c.updateAAD(KEY_AAD)
                return SecretKeySpec(c.doFinal(data, 12, data.size - 12), "AES")
            } catch (_: Exception) {
                // the wrapping key is gone (e.g. app data restored elsewhere): offline data can't be read, start over
                clearFiles()
            }
        }
        val raw = ByteArray(32).also { random.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, keystoreKey())
        c.updateAAD(KEY_AAD)
        writeAtomic(f, c.iv + c.doFinal(raw))
        return SecretKeySpec(raw, "AES")
    }

    private fun seal(plain: ByteArray, aad: ByteArray): ByteArray {
        val iv = ByteArray(12).also { random.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, dek, GCMParameterSpec(128, iv))
        c.updateAAD(aad)
        return iv + c.doFinal(plain)
    }

    private fun open(data: ByteArray, aad: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, dek, GCMParameterSpec(128, data, 0, 12))
        c.updateAAD(aad)
        return c.doFinal(data, 12, data.size - 12)
    }

    private fun writeAtomic(f: File, bytes: ByteArray) {
        val tmp = File(f.path + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }

    private inline fun <reified T> readJson(name: String): T? = try {
        val f = File(dir, name)
        if (!f.exists()) null else json.decodeFromString<T>(String(open(f.readBytes(), "better-anki/offline/$name".toByteArray())))
    } catch (_: Exception) {
        null
    }

    private inline fun <reified T> writeJson(name: String, value: T) =
        writeAtomic(File(dir, name), seal(json.encodeToString(kotlinx.serialization.serializer<T>(), value).toByteArray(), "better-anki/offline/$name".toByteArray()))

    // ------------------------------------------------------------ data

    fun loadPack(): Pack? = readJson("pack.bin")
    fun savePack(p: Pack) = writeJson("pack.bin", p)
    fun loadLog(): OfflineLog = readJson("log.bin") ?: OfflineLog()
    fun saveLog(l: OfflineLog) = writeJson("log.bin", l)

    private fun mediaFile(name: String): File {
        val h = MessageDigest.getInstance("SHA-256").digest(name.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(mediaDir, "$h.bin")
    }
    fun hasMedia(name: String) = mediaFile(name).exists()
    fun putMedia(name: String, bytes: ByteArray) = writeAtomic(mediaFile(name), seal(bytes, "better-anki/offline/media/$name".toByteArray()))
    fun getMedia(name: String): ByteArray? = try {
        mediaFile(name).takeIf { it.exists() }?.let { open(it.readBytes(), "better-anki/offline/media/$name".toByteArray()) }
    } catch (_: Exception) {
        null
    }
    /** Delete media files no longer referenced by the pack. */
    fun pruneMedia(keep: Collection<String>) {
        val wanted = keep.map { mediaFile(it).name }.toSet()
        mediaDir.listFiles()?.forEach { if (it.name !in wanted) it.delete() }
    }
    fun mediaBytes(): Long = mediaDir.listFiles()?.sumOf { it.length() } ?: 0L
    fun packBytes(): Long = File(dir, "pack.bin").length()

    private fun clearFiles() {
        mediaDir.listFiles()?.forEach { it.delete() }
        dir.listFiles()?.forEach { if (it.isFile) it.delete() }
    }
    /** Remove all offline data (the log too: only call when nothing is waiting to sync, or to discard it). Keeps the data key. */
    fun clear() {
        mediaDir.listFiles()?.forEach { it.delete() }
        dir.listFiles()?.forEach { if (it.isFile && it.name != "key.bin") it.delete() }
    }

    companion object {
        private const val ALIAS = "better-anki-offline-key"
        private val KEY_AAD = "better-anki/offline/data-key/v1".toByteArray()
    }
}
