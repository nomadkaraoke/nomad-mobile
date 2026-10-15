/* global jest */
// In-memory SecureStore so auth persistence is testable without native modules.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k) => void store.delete(k)),
  };
});

// In-memory MMKV (cleared on "reinstall" by tests via __resetMMKV).
jest.mock('react-native-mmkv', () => {
  const stores = new Map();
  return {
    createMMKV: ({ id = 'default' } = {}) => {
      if (!stores.has(id)) stores.set(id, new Map());
      const s = stores.get(id);
      return {
        set: (k, v) => void s.set(k, v),
        getString: (k) => (typeof s.get(k) === 'string' ? s.get(k) : undefined),
        getBoolean: (k) => (typeof s.get(k) === 'boolean' ? s.get(k) : undefined),
        remove: (k) => s.delete(k),
        clearAll: () => s.clear(),
      };
    },
    __resetMMKV: () => stores.forEach((s) => s.clear()),
  };
});
