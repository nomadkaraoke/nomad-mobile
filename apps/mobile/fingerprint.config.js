/**
 * @expo/fingerprint config (runtimeVersion policy 'fingerprint'; docs/RELEASE.md § Runtime version).
 *
 * A local Gradle build rewrites library manifests in node_modules in place: React Native's Gradle plugin strips the
 * legacy `package="…"` attribute from a library's AndroidManifest.xml once it sets the AGP namespace (seen on
 * @react-native-masked-view/masked-view). The fingerprint of a Mac that has run `expo run:android` then differed from
 * EAS's clean install, and EAS failed the build at "Configure expo-updates" (build cc98aaa1, 2026-10-25). This hook
 * hashes node_modules manifests without that attribute and without whitespace, so the hash is the same before and
 * after a local build. Any other manifest change (permissions, components) still changes the fingerprint.
 */
const LIBRARY_MANIFEST = /(^|\/)node_modules\/.+\/AndroidManifest\.xml$/;
const PACKAGE_ATTR = /(?<![\w:.-])package\s*=\s*"[^"]*"/g;

/** Buffered contents per file (the hook sees 1 KiB chunks; the source object is one per file). */
const pending = new WeakMap();

/** @param {string} xml */
const normalizeLibraryManifest = (xml) => xml.replace(PACKAGE_ATTR, '').replace(/\s+/g, '');

/** @type {import('@expo/fingerprint').Config} */
const config = {
  fileHookTransform: (source, chunk, isEndOfFile) => {
    if (source.type !== 'file' || !LIBRARY_MANIFEST.test(source.filePath.replace(/\\/g, '/'))) return chunk;
    const text = (pending.get(source) ?? '') + (chunk == null ? '' : typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    if (!isEndOfFile) {
      pending.set(source, text);
      return null;
    }
    pending.delete(source);
    return normalizeLibraryManifest(text);
  },
};

module.exports = config;
module.exports.normalizeLibraryManifest = normalizeLibraryManifest;
