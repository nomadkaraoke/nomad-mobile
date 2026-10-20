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
  /** Set by `finish()`: the review was submitted; edits and draft writes are ignored from then on. */
  finished: boolean;
  /** Applies an edit: pushes undo, counts it, schedules a draft save. A no-op (same doc) is ignored. */
  apply(op: (d: ReviewDoc) => ReviewDoc): void;
  /**
   * Opens a gesture (a held step button): every apply until `endGesture` coalesces into ONE undo
   * entry and one edit, so a long hold can't flood the capped undo history.
   */
  beginGesture(): void;
  endGesture(): void;
  setDuet(on: boolean): void;
  undoLast(): void;
  /** Drops the draft and every edit, back to what gen sent. */
  discard(): void;
  setSelection(c: InstrumentalChoice | null): void;
  /** Writes any pending draft now (call when leaving the screen). */
  flushDraft(): void;
  /**
   * The review was submitted: cancels any pending draft write, deletes the draft, and turns every later
   * edit, selection change and draft write into a no-op (a stale draft must not outlive the submit).
   */
  finish(): void;
};

/** One store per mounted review. Restores a draft saved against the same audio, else starts from `data`. */
export function createReviewStore(jobId: string, data: CorrectionData): StoreApi<ReviewStore> {
  const audioHash = data.metadata?.audio_hash ?? null;
  const draft = loadDraft(jobId, audioHash);
  const serverDoc = fromCorrectionData(data);
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Open gesture: null when none; `pushed` once its single undo snapshot is taken.
  let gesture: { pushed: boolean } | null = null;
  let finished = false;

  return createStore<ReviewStore>()((set, get) => {
    const writeDraft = () => {
      timer = null;
      if (finished) return;
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
      if (finished) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(writeDraft, DRAFT_DEBOUNCE_MS);
    };
    const cancelDraft = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const applyOp = (op: (d: ReviewDoc) => ReviewDoc, extra: Partial<ReviewStore> = {}) => {
      if (finished) return;
      const { doc, undo, editCount } = get();
      const next = op(doc);
      if (next === doc) return;
      if (gesture?.pushed) {
        set({ doc: next, ...extra });
      } else {
        undo.push(doc);
        if (gesture) gesture.pushed = true;
        set({ doc: next, editCount: editCount + 1, ...extra });
      }
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
      finished: false,

      apply: (op) => applyOp(op),
      beginGesture() {
        gesture = { pushed: false };
      },
      endGesture() {
        gesture = null;
      },
      setDuet: (on) => applyOp((d) => (d.isDuet === on ? d : setDuet(d, on)), { isDuetTouched: true }),
      undoLast() {
        if (finished) return;
        gesture = null;
        const { doc, undo } = get();
        const prev = undo.undo(doc);
        if (!prev) return;
        set({ doc: prev });
        scheduleDraft();
      },
      discard() {
        if (finished) return;
        gesture = null;
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
        if (finished) return;
        set({ selection: c, selectionTouched: true });
        scheduleDraft();
      },
      flushDraft() {
        if (timer) {
          cancelDraft();
          writeDraft();
        }
      },
      finish() {
        finished = true;
        gesture = null;
        cancelDraft();
        clearDraft(jobId);
        set({ finished: true });
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
