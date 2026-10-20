import {
  fromCorrectionData,
  setDuet,
  UndoStack,
  type CorrectionData,
  type InstrumentalChoice,
  type ReviewDoc,
} from '@nomad/review-core';
import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';

import { clearDraft, loadDraft, saveDraft } from './drafts';

export const DRAFT_DEBOUNCE_MS = 1000;

export type ReviewStore = {
  doc: ReviewDoc;
  undo: UndoStack<ReviewDoc>;
  editCount: number;
  selection: InstrumentalChoice | null;
  selectionTouched: boolean;
  /** True once the person toggled duet: is_duet is only sent to gen when loaded true or touched. */
  isDuetTouched: boolean;
  restoredFromDraft: boolean;
  /** Applies an edit: pushes undo, counts it, schedules a draft save. A no-op (same doc) is ignored. */
  apply(op: (d: ReviewDoc) => ReviewDoc): void;
  setDuet(on: boolean): void;
  undoLast(): void;
  /** Drops the draft and every edit, back to what gen sent. */
  discard(): void;
  setSelection(c: InstrumentalChoice | null): void;
  /** Writes any pending draft now (call when leaving the screen). */
  flushDraft(): void;
};

/** One store per mounted review. Restores a draft saved against the same audio, else starts from `data`. */
export function createReviewStore(jobId: string, data: CorrectionData): StoreApi<ReviewStore> {
  const audioHash = data.metadata?.audio_hash ?? null;
  const draft = loadDraft(jobId, audioHash);
  const serverDoc = fromCorrectionData(data);
  let timer: ReturnType<typeof setTimeout> | null = null;

  return createStore<ReviewStore>()((set, get) => {
    const writeDraft = () => {
      timer = null;
      const s = get();
      saveDraft(jobId, {
        v: 1,
        audioHash,
        segments: [...s.doc.segments],
        isDuet: s.doc.isDuet,
        isDuetTouched: s.isDuetTouched,
        selection: s.selection,
        editCount: s.editCount,
        savedAt: Date.now(),
      });
    };
    const scheduleDraft = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(writeDraft, DRAFT_DEBOUNCE_MS);
    };
    const cancelDraft = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const applyOp = (op: (d: ReviewDoc) => ReviewDoc, extra: Partial<ReviewStore> = {}) => {
      const { doc, undo, editCount } = get();
      const next = op(doc);
      if (next === doc) return;
      undo.push(doc);
      set({ doc: next, editCount: editCount + 1, ...extra });
      scheduleDraft();
    };

    return {
      doc: draft ? { source: data, segments: draft.segments, isDuet: draft.isDuet } : serverDoc,
      undo: new UndoStack<ReviewDoc>(),
      editCount: draft?.editCount ?? 0,
      selection: draft?.selection ?? null,
      selectionTouched: draft?.selection != null,
      isDuetTouched: draft?.isDuetTouched ?? false,
      restoredFromDraft: draft !== null,

      apply: (op) => applyOp(op),
      setDuet: (on) => applyOp((d) => (d.isDuet === on ? d : setDuet(d, on)), { isDuetTouched: true }),
      undoLast() {
        const { doc, undo } = get();
        const prev = undo.undo(doc);
        if (!prev) return;
        set({ doc: prev });
        scheduleDraft();
      },
      discard() {
        cancelDraft();
        clearDraft(jobId);
        get().undo.clear();
        set({
          doc: serverDoc,
          editCount: 0,
          selection: null,
          selectionTouched: false,
          isDuetTouched: false,
          restoredFromDraft: false,
        });
      },
      setSelection(c) {
        set({ selection: c, selectionTouched: true });
        scheduleDraft();
      },
      flushDraft() {
        if (timer) {
          cancelDraft();
          writeDraft();
        }
      },
    };
  });
}

export const ReviewStoreContext = createContext<StoreApi<ReviewStore> | null>(null);

/** Select from the review store provided by `ReviewStoreContext.Provider`. */
export function useReviewStore<T>(selector: (s: ReviewStore) => T): T {
  const store = useContext(ReviewStoreContext);
  if (!store) throw new Error('useReviewStore must be used inside a ReviewStoreContext.Provider');
  return useStore(store, selector);
}
