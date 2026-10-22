import { create } from 'zustand';

/**
 * Discover's personal data (recommendations, quiz, hidden songs) comes from decide, whose answer to a gen
 * session it doesn't accept (or can't reach) must never sign the user out: gen owns identity. A decide 401
 * only marks that data stale; Discover shows a refresh prompt and calls `clear()` after a good reload.
 */
type StaleStore = {
  stale: boolean;
  markStale(): void;
  clear(): void;
};

export const useDiscoverStale = create<StaleStore>((set) => ({
  stale: false,
  markStale: () => set({ stale: true }),
  clear: () => set({ stale: false }),
}));
