import { previewClose, previewResolve, type PreviewRequest, type PreviewResult } from '@nomad/api-kjbox';
import { create } from 'zustand';

/** What to preview: a search version (with the web's descriptor fields) or a rotation entry. */
export type PreviewTarget = {
  /** The screen showing it ('night', 'search'): only that screen's sheet renders it and its lifecycle closes it. */
  owner: string;
  title: string;
  artist?: string;
  source: PreviewRequest['source'];
  entryId?: number;
  /** Search versions: local `file_path`, divebar `file_id`/`format`, youtube `youtube_url`, plus a display `title`. */
  extra?: Record<string, unknown>;
};

export type CurrentPreview = PreviewTarget & {
  id: number;
  code: string;
  nightId?: string;
  status: 'loading' | 'ready' | 'error';
  result?: PreviewResult;
};

type PreviewState = {
  current: CurrentPreview | null;
  /** Starts a preview; any other one is stopped and closed first (ruling E10-R1: one at a time, app-wide). */
  open(code: string, nightId: string | undefined, target: PreviewTarget): Promise<void>;
  /** Stops the current preview and releases its token on the box. */
  close(): void;
  /** Closes the current preview only if `owner` shows it (leaving or unmounting that screen). */
  closeOwner(owner: string): void;
};

/** Best-effort: the box frees the transcode cache when told; a failure only means it expires on its own. */
function release(code: string, token: string | undefined, nightId?: string): void {
  if (!token) return;
  try {
    void Promise.resolve(previewClose(code, token, nightId)).catch(() => undefined);
  } catch {
    /* never surfaces */
  }
}

let seq = 0;

export const usePreviewStore = create<PreviewState>((set, get) => ({
  current: null,
  open: async (code, nightId, target) => {
    get().close();
    const id = ++seq;
    set({ current: { ...target, id, code, nightId, status: 'loading' } });
    try {
      const result = await previewResolve(code, target.source, target.entryId, nightId, target.extra);
      const cur = get().current;
      if (cur?.id !== id) {
        // Closed or replaced while resolving: give the token straight back.
        release(code, result?.token, nightId);
        return;
      }
      set({ current: { ...cur, status: result && result.mode !== 'unavailable' ? 'ready' : 'error', result } });
    } catch {
      // Rate limit, not found, unreachable…: the sheet says "Preview isn't available right now" (ruling E10-R2).
      const cur = get().current;
      if (cur?.id === id) set({ current: { ...cur, status: 'error' } });
    }
  },
  close: () => {
    const cur = get().current;
    if (!cur) return;
    set({ current: null });
    release(cur.code, cur.result?.token, cur.nightId);
  },
  closeOwner: (owner) => {
    if (get().current?.owner === owner) get().close();
  },
}));
