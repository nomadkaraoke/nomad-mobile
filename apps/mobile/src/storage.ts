import { createMMKV } from 'react-native-mmkv';

/** Fast app-sandbox key/value storage. Wiped on uninstall (unlike the iOS Keychain). */
export const appStorage = createMMKV({ id: 'nomad-app' });

/** Every MMKV instance the app opens: account deletion clears them all. Add any new instance here. */
export const ALL_STORAGES = [appStorage];
