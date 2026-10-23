package com.nomadkaraoke.shareintake

import java.io.File
import java.io.InputStream

/** Pure rules behind ShareIntakeModule, kept free of Android types so they run as plain JVM unit tests. */
internal object ShareIntakeRules {
  /** Largest export the app copies: well above a real Extended streaming history zip. */
  const val MAX_BYTES: Long = 256L * 1024 * 1024

  private const val MAX_NAME = 120
  private const val FALLBACK_NAME = "shared-export"

  /**
   * Only a `content://` stream from another app's provider. A `file://` uri, or one of this app's own providers,
   * would let a sender make the app copy its own private files into a place it then reads (a confused deputy).
   * [providerPackage] is the package that owns the uri's authority (null when no provider resolves).
   */
  fun isAcceptableSource(scheme: String?, providerPackage: String?, ownPackage: String): Boolean =
    scheme.equals("content", ignoreCase = true) && providerPackage != null && providerPackage != ownPackage

  /**
   * A plain file name of [A-Za-z0-9._-] only (so "my spotify data.zip" -> "my_spotify_data.zip"): no path
   * separators or leading dots, and nothing a URL query cares about, since the uri and name travel as route params
   * and inside the sign-in sheet's nested returnTo. Truncation keeps the extension. Never empty.
   */
  fun safeName(raw: String?): String {
    val base = raw.orEmpty().substringAfterLast('/').substringAfterLast('\\').trim()
    val cleaned = base.replace(Regex("[^A-Za-z0-9._-]"), "_").trimStart('.')
    if (cleaned.isEmpty() || cleaned.all { it == '_' || it == '.' }) return FALLBACK_NAME
    if (cleaned.length <= MAX_NAME) return cleaned
    val dot = cleaned.lastIndexOf('.')
    val ext = if (dot > 0 && cleaned.length - dot <= 10) cleaned.substring(dot) else ""
    return cleaned.take(MAX_NAME - ext.length) + ext
  }

  /**
   * Copies at most [maxBytes] from [input] into [target]. Returns false, with the partial file deleted, when the
   * stream is larger or the copy fails.
   */
  fun copyBounded(input: InputStream, target: File, maxBytes: Long = MAX_BYTES): Boolean {
    val ok = try {
      var total = 0L
      var fits = true
      target.outputStream().use { out ->
        val buf = ByteArray(64 * 1024)
        while (true) {
          val n = input.read(buf)
          if (n < 0) break
          total += n
          if (total > maxBytes) {
            fits = false
            break
          }
          out.write(buf, 0, n)
        }
      }
      fits
    } catch (e: Exception) {
      false
    }
    if (!ok) target.delete()
    return ok
  }

  /** Drops earlier shares' folders older than [maxAgeMs] (a newer one may still be read by the import screen). */
  fun pruneOld(sharedRoot: File, now: Long, maxAgeMs: Long = 60 * 60 * 1000L) {
    sharedRoot.listFiles()?.forEach { if (now - it.lastModified() > maxAgeMs) it.deleteRecursively() }
  }
}
