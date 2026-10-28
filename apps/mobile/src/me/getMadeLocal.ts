import type { GetMadeItem } from '@nomad/api-decide';
import { create } from 'zustand';

/** The requests board query (public, plus the signed-in person's daily vote state). */
export const BOARD_QUERY_KEY = ['gen', 'requests-board'] as const;

/** How long the "Hidden · Undo" toast stays up. */
export const UNDO_MS = 5_000;

/**
 * What "Request it free" did for a row this session. `requested` carries the board's vote count from the response;
 * `vote_used` / `submission_limit` are gen's daily limits (the row never claims "requested" for those).
 */
export type RequestState =
  | { kind: 'pending' }
  | { kind: 'requested'; votes: number }
  | { kind: 'vote_used' }
  | { kind: 'submission_limit' }
  | { kind: 'error' };

type GetMadeLocal = {
  /**
   * Dismiss / undo taps this session, newest per key, with the row they were made on (so an undo can show the row
   * again even if a refetch already left it out). The Me outbox carries them to decide.
   */
  dismissed: Record<string, { dismissed: boolean; item: GetMadeItem; sentAt?: number }>;
  requests: Record<string, RequestState>;
  /** The row the undo toast is for. */
  toast: string | null;
  setDismissed(item: GetMadeItem, dismissed: boolean): void;
  setRequest(key: string, state: RequestState): void;
  /** An undo (undismiss) reached decide at `at`. */
  markSent(key: string, at: number): void;
  /**
   * A get-made response that started at `startedAt` landed: a restored (undone) row is no longer pinned once the
   * server lists it again, or once a fetch started after its undo was sent.
   */
  settle(serverKeys: ReadonlySet<string>, startedAt: number): void;
  /** Account change: none of this belongs to the next person. */
  clear(): void;
};

let toastTimer: ReturnType<typeof setTimeout> | null = null;
const stopTimer = () => {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
};

/** Session-only (memory) state for Get this made: optimistic dismissals, request outcomes, the undo toast. */
export const useGetMadeLocal = create<GetMadeLocal>((set) => ({
  dismissed: {},
  requests: {},
  toast: null,
  setDismissed(item, dismissed) {
    stopTimer();
    set((s) => ({ dismissed: { ...s.dismissed, [item.key]: { dismissed, item } }, toast: dismissed ? item.key : null }));
    if (dismissed) {
      toastTimer = setTimeout(() => {
        toastTimer = null;
        set((s) => (s.toast === item.key ? { toast: null } : s));
      }, UNDO_MS);
    }
  },
  setRequest(key, state) {
    set((s) => ({ requests: { ...s.requests, [key]: state } }));
  },
  markSent(key, at) {
    set((s) => {
      const d = s.dismissed[key];
      return d && !d.dismissed ? { dismissed: { ...s.dismissed, [key]: { ...d, sentAt: at } } } : s;
    });
  },
  settle(serverKeys, startedAt) {
    set((s) => {
      const drop = Object.entries(s.dismissed).filter(
        ([k, d]) => !d.dismissed && (serverKeys.has(k) || (d.sentAt !== undefined && startedAt > d.sentAt)),
      );
      if (drop.length === 0) return s;
      const dismissed = { ...s.dismissed };
      for (const [k] of drop) delete dismissed[k];
      return { dismissed };
    });
  },
  clear() {
    stopTimer();
    set({ dismissed: {}, requests: {}, toast: null });
  },
}));
