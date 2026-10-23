package com.nomadkaraoke.shareintake

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream

class ShareIntakeRulesTest {
  @get:Rule val tmp = TemporaryFolder()

  private val own = "com.nomadkaraoke.mobile"

  @Test fun safeNameDropsPathTraversal() {
    assertEquals("x.zip", ShareIntakeRules.safeName("../../files/x.zip"))
    assertEquals("shared-export", ShareIntakeRules.safeName(".."))
    assertEquals("b.csv", ShareIntakeRules.safeName("a\\b.csv"))
    assertEquals("passwd", ShareIntakeRules.safeName("/etc/../passwd"))
  }

  @Test fun safeNameFallsBackWhenEmpty() {
    assertEquals("shared-export", ShareIntakeRules.safeName(""))
    assertEquals("shared-export", ShareIntakeRules.safeName(null))
    assertEquals("shared-export", ShareIntakeRules.safeName("   "))
    assertEquals("shared-export", ShareIntakeRules.safeName("..."))
  }

  @Test fun safeNameReplacesUnsafeAndUnicodeCharacters() {
    assertEquals("my_spotify_data.zip", ShareIntakeRules.safeName("my spotify data.zip"))
    assertEquals("R_B__1_100_.zip", ShareIntakeRules.safeName("R&B #1 100%.zip"))
    assertEquals("Mu_sica_.csv", ShareIntakeRules.safeName("Música♪.csv"))
    assertEquals("hidden.zip", ShareIntakeRules.safeName(".hidden.zip"))
  }

  @Test fun safeNameKeepsTheExtensionWhenTruncating() {
    val name = ShareIntakeRules.safeName("a".repeat(300) + ".zip")
    assertEquals(120, name.length)
    assertTrue(name.endsWith(".zip"))
  }

  @Test fun acceptsOnlyAnotherAppsContentProvider() {
    assertTrue(ShareIntakeRules.isAcceptableSource("content", "com.android.providers.media.module", own))
    assertTrue(ShareIntakeRules.isAcceptableSource("CONTENT", "com.google.android.apps.docs", own))
    assertFalse(ShareIntakeRules.isAcceptableSource("file", null, own))
    assertFalse(ShareIntakeRules.isAcceptableSource("file", "com.android.providers.media.module", own))
    assertFalse(ShareIntakeRules.isAcceptableSource(null, "com.android.providers.media.module", own))
    assertFalse(ShareIntakeRules.isAcceptableSource("content", own, own)) // our own FileProvider
    assertFalse(ShareIntakeRules.isAcceptableSource("content", null, own)) // no provider resolves
  }

  @Test fun copyBoundedCopiesUpToTheCap() {
    val target = File(tmp.root, "ok.zip")
    assertTrue(ShareIntakeRules.copyBounded(ByteArrayInputStream(ByteArray(100) { 1 }), target, maxBytes = 100))
    assertEquals(100L, target.length())
  }

  @Test fun copyBoundedDeletesTheFileWhenOverTheCap() {
    val target = File(tmp.root, "big.zip")
    assertFalse(ShareIntakeRules.copyBounded(ByteArrayInputStream(ByteArray(101)), target, maxBytes = 100))
    assertFalse(target.exists())
  }

  @Test fun copyBoundedDeletesThePartialFileOnAReadError() {
    val target = File(tmp.root, "broken.zip")
    val failing = object : InputStream() {
      var n = 0
      override fun read(): Int = if (n++ < 10) 1 else throw IOException("provider gone")
      override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (n >= 10) throw IOException("provider gone")
        b[off] = 1
        n++
        return 1
      }
    }
    assertFalse(ShareIntakeRules.copyBounded(failing, target, maxBytes = 1000))
    assertFalse(target.exists())
  }

  @Test fun pruneOldKeepsRecentShares() {
    val root = tmp.newFolder("shared")
    val old = File(root, "old").apply { mkdirs(); setLastModified(1_000L) }
    val fresh = File(root, "fresh").apply { mkdirs(); setLastModified(10_000_000L) }
    ShareIntakeRules.pruneOld(root, now = 10_000_000L + 1_000L, maxAgeMs = 60_000L)
    assertFalse(old.exists())
    assertTrue(fresh.exists())
  }
}
