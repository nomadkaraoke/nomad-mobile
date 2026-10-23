package com.nomadkaraoke.shareintake

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch
import java.io.File

/**
 * Android Share -> Nomad Karaoke (Phase 3b Task 24). plugins/withShareIntake.ts gives MainActivity a SEND filter for
 * export zips and CSVs; this copies the shared content:// stream into `cacheDir/shared/<name>` (the import screen
 * reads a file:// uri with a known size) and hands JS `{uri, name, mimeType}`: once for the launch intent
 * (`getInitialSharedFile`), then an `onSharedFile` event for each share while the app is running.
 */
class ShareIntakeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShareIntake")

    Events(EVENT)

    // Async: an Extended streaming history zip can be tens of MB, so the copy stays off the UI thread.
    AsyncFunction("getInitialSharedFile") {
      val intent = appContext.currentActivity?.intent ?: return@AsyncFunction null
      take(intent)
    }

    OnNewIntent { intent ->
      if (!isShare(intent)) return@OnNewIntent
      appContext.backgroundCoroutineScope.launch {
        val file = try {
          take(intent)
        } catch (e: Exception) {
          Log.w(TAG, "shared file unreadable", e)
          null
        }
        if (file != null) sendEvent(EVENT, file)
      }
    }
  }

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context lost" }

  private fun isShare(intent: Intent) = intent.action == Intent.ACTION_SEND && streamOf(intent) != null

  @Suppress("DEPRECATION")
  private fun streamOf(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    else intent.getParcelableExtra(Intent.EXTRA_STREAM)

  /** Copies the intent's shared stream into the cache and forgets it (a JS reload must not import it again). */
  private fun take(intent: Intent): Map<String, String>? {
    if (intent.action != Intent.ACTION_SEND) return null
    val source = streamOf(intent) ?: return null
    intent.removeExtra(Intent.EXTRA_STREAM)
    val resolver = context.contentResolver
    val name = safeName(displayName(source))
    val dir = File(context.cacheDir, "shared").apply { mkdirs() }
    // One shared export at a time: drop copies an earlier, abandoned share left behind.
    dir.listFiles()?.forEach { it.delete() }
    val target = File(dir, name)
    val input = resolver.openInputStream(source) ?: return null
    input.use { src -> target.outputStream().use { dst -> src.copyTo(dst) } }
    val mimeType = intent.type ?: resolver.getType(source) ?: ""
    // The cache path and safeName() are URL-safe, so the plain path is the uri (no percent-encoding to undo).
    return mapOf("uri" to "file://${target.absolutePath}", "name" to name, "mimeType" to mimeType)
  }

  private fun displayName(uri: Uri): String? {
    if (uri.scheme == "content") {
      try {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
          if (c.moveToFirst()) {
            val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (i >= 0 && !c.isNull(i)) return c.getString(i)
          }
        }
      } catch (e: Exception) {
        Log.w(TAG, "no display name for shared file", e)
      }
    }
    return uri.lastPathSegment
  }

  companion object {
    private const val TAG = "ShareIntake"
    private const val EVENT = "onSharedFile"

    /**
     * A plain file name of [A-Za-z0-9._-] only (so "my spotify data.zip" -> "my_spotify_data.zip"): no path
     * separators or leading dots, and nothing a URL query cares about, since the uri and name travel as route
     * params and inside the sign-in sheet's nested returnTo. Never empty.
     */
    internal fun safeName(raw: String?): String {
      val base = raw.orEmpty().substringAfterLast('/').substringAfterLast('\\').trim()
      return base.replace(Regex("[^A-Za-z0-9._-]"), "_").trimStart('.').take(120).ifEmpty { "shared-export" }
    }
  }
}
