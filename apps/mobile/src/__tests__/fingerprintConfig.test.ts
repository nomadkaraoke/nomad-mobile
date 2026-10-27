type Hook = (source: object, chunk: Buffer | string | null, isEndOfFile: boolean) => Buffer | string | null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fileHookTransform } = require('../../fingerprint.config') as { fileHookTransform: Hook };

/** Feeds `text` through the hook in `size`-byte chunks, as @expo/fingerprint's FileHookTransform does. */
const hashInput = (filePath: string, text: string, size = 1024): string => {
  const source = { type: 'file', filePath };
  const buf = Buffer.from(text);
  let out = '';
  for (let i = 0; i < buf.length; i += size) {
    const r = fileHookTransform(source, buf.subarray(i, i + size), false);
    if (r != null) out += r.toString();
  }
  const end = fileHookTransform(source, null, true);
  if (end != null) out += end.toString();
  return out;
};

const LIB = '../../node_modules/@react-native-masked-view/masked-view/android/src/main/AndroidManifest.xml';
const PRISTINE = '<manifest package="org.reactnative.maskedview" xmlns:android="http://schemas.android.com/apk/res/android">\n</manifest>\n';
// What React Native's Gradle plugin leaves behind after a local Android build.
const STRIPPED = '<manifest  xmlns:android="http://schemas.android.com/apk/res/android">\n</manifest>\n';

describe('fingerprint.config fileHookTransform', () => {
  it('hashes a library manifest the same before and after a local Gradle build strips package=', () => {
    expect(hashInput(LIB, PRISTINE)).toBe(hashInput(LIB, STRIPPED));
  });

  it('is chunk-safe (attribute split across chunks, multi-line opening tag)', () => {
    const multi = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    package="com.example.lib">\n</manifest>\n';
    const multiStripped = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    >\n</manifest>\n';
    expect(hashInput(LIB, multi, 7)).toBe(hashInput(LIB, multiStripped, 1024));
  });

  it('still changes when a library manifest really changes (a permission)', () => {
    const withPerm = STRIPPED.replace('</manifest>', '<uses-permission android:name="android.permission.CAMERA"/></manifest>');
    expect(hashInput(LIB, withPerm)).not.toBe(hashInput(LIB, STRIPPED));
  });

  it('leaves other files untouched, including the app manifest', () => {
    const source = { type: 'file', filePath: 'android/app/src/main/AndroidManifest.xml' };
    const chunk = Buffer.from(PRISTINE);
    expect(fileHookTransform(source, chunk, false)).toBe(chunk);
    expect(fileHookTransform({ type: 'file', filePath: '../../node_modules/x/build.gradle' }, 'a b', false)).toBe('a b');
  });
});
