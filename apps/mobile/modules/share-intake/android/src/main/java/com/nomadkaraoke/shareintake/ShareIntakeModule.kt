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
import java.util.concurrent.atomic.AtomicInteger

/**
 * Android Share -> Nomad Karaoke (Phase 3b Task 24). plugins/withShareIntake.ts gives MainActivity a SEND filter for
 * export zips and CSVs; this copies the shared content:// stream into `cacheDir/shared/<per-share dir>/<name>` (the import screen
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

  /** A fresh SEND with a stream; not a replay of an old share from Recents. */
  private fun isShare(intent: Intent) =
    intent.action == Intent.ACTION_SEND &&
      intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0 &&
      streamOf(intent) != null

  @Suppress("DEPRECATION")
  private fun streamOf(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    else intent.getParcelableExtra(Intent.EXTRA_STREAM)

  /**
   * Copies the intent's shared stream into `cacheDir/shared/<per-share dir>/<name>` and forgets it (a JS reload must
   * not import it again). Null when it isn't a share, the source isn't another app's content:// provider, the stream
   * is over [ShareIntakeRules.MAX_BYTES], or the copy fails.
   */
  private fun take(intent: Intent): Map<String, String>? {
    if (!isShare(intent)) return null
    val source = streamOf(intent) ?: return null
    intent.removeExtra(Intent.EXTRA_STREAM)
    val ctx = context
    val owner = source.authority?.let { ctx.packageManager.resolveContentProvider(it, 0)?.packageName }
    if (!ShareIntakeRules.isAcceptableSource(source.scheme, owner, ctx.packageName)) {
      Log.w(TAG, "ignored a share from ${source.scheme}://${source.authority}")
      return null
    }
    val resolver = ctx.contentResolver
    val name = ShareIntakeRules.safeName(displayName(source))
    val root = File(ctx.cacheDir, "shared").apply { mkdirs() }
    ShareIntakeRules.pruneOld(root, System.currentTimeMillis())
    // Each share gets its own folder: a second share never deletes a file the import screen is still reading.
    val dir = File(root, "${System.currentTimeMillis()}-${shareCount.incrementAndGet()}").apply { mkdirs() }
    val target = File(dir, name)
    val copied = try {
      resolver.openInputStream(source)?.use { ShareIntakeRules.copyBounded(it, target) } ?: false
    } catch (e: Exception) {
      false // e.g. SecurityException: the sender didn't grant read access
    }
    if (!copied) {
      dir.deleteRecursively()
      Log.w(TAG, "shared file too large or unreadable")
      return null
    }
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
    private val shareCount = AtomicInteger()
  }
}
