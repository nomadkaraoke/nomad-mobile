import { createMMKV } from 'react-native-mmkv';

/** Fast app-sandbox key/value storage. Wiped on uninstall (unlike the iOS Keychain). */
export const appStorage = createMMKV({ id: 'nomad-app' });
