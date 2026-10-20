import type { CorrectionData, LyricsSegment } from '@nomad/review-core';

import { clearDraft, loadDraft, saveDraft, type Draft } from '../../review/drafts';
import { createReviewStore } from '../../review/store';

const seg = (id: string, text: string): LyricsSegment =>
  ({ id, text, words: [{ id: `${id}w`, text, start_time: 1, end_time: 2 }], start_time: 1, end_time: 2 }) as unknown as LyricsSegment;

const data = (hash: string | null = 'h1'): CorrectionData =>
  ({
    corrected_segments: [seg('a', 'hello'), seg('b', 'world')],
    metadata: hash === null ? {} : { audio_hash: hash },
  }) as unknown as CorrectionData;

const rename = (d: { segments: readonly LyricsSegment[] } & Record<string, unknown>) => ({
  ...d,
  segments: [seg('a', 'HELLO'), d.segments[1]!],
});

beforeEach(() => {
  jest.useFakeTimers();
  require('react-native-mmkv').__resetMMKV();
});
afterEach(() => jest.useRealTimers());

describe('review store', () => {
  it('apply pushes undo, bumps editCount and undoLast restores', () => {
    const store = createReviewStore('j1', data());
    const before = store.getState().doc;
    store.getState().apply((d) => rename(d as never) as never);
    expect(store.getState().doc.segments[0]!.text).toBe('HELLO');
    expect(store.getState().editCount).toBe(1);
    expect(store.getState().undo.canUndo).toBe(true);
    store.getState().undoLast();
    expect(store.getState().doc).toBe(before);
  });

  it('a gesture coalesces its applies into one undo entry and one edit', () => {
    const store = createReviewStore('j1', data());
    const before = store.getState().doc;
    const bump = (d: { segments: readonly LyricsSegment[] } & Record<string, unknown>) => ({
      ...d,
      segments: [seg('a', `${d.segments[0]!.text}!`), d.segments[1]!],
    });
    store.getState().beginGesture();
    for (let i = 0; i < 150; i++) store.getState().apply((d) => bump(d as never) as never);
    store.getState().endGesture();
    expect(store.getState().doc.segments[0]!.text).toBe(`hello${'!'.repeat(150)}`);
    expect(store.getState().editCount).toBe(1);
    store.getState().undoLast();
    expect(store.getState().doc).toBe(before);
    expect(store.getState().undo.canUndo).toBe(false);

    // After the gesture, applies push again; a gesture with no change pushes nothing.
    store.getState().beginGesture();
    store.getState().apply((d) => d);
    store.getState().endGesture();
    expect(store.getState().undo.canUndo).toBe(false);
    store.getState().apply((d) => bump(d as never) as never);
    store.getState().apply((d) => bump(d as never) as never);
    expect(store.getState().editCount).toBe(3);
  });

  it('ignores an op that returns the same doc', () => {
    const store = createReviewStore('j1', data());
    store.getState().apply((d) => d);
    expect(store.getState().editCount).toBe(0);
    expect(store.getState().undo.canUndo).toBe(false);
  });

  it('saves the draft after a 1 s debounce, with no URLs or tokens', () => {
    const store = createReviewStore('j1', data());
    store.getState().apply((d) => rename(d as never) as never);
    expect(loadDraft('j1', 'h1')).toBeNull();
    jest.advanceTimersByTime(999);
    expect(loadDraft('j1', 'h1')).toBeNull();
    jest.advanceTimersByTime(1);
    const draft = loadDraft('j1', 'h1')!;
    expect(draft.segments[0]!.text).toBe('HELLO');
    expect(draft.editCount).toBe(1);
    const raw = require('../../storage').appStorage.getString('review-draft:j1') as string;
    expect(raw).not.toMatch(/http|token/i);
  });

  it('restores a draft with the same audio hash', () => {
    const a = createReviewStore('j1', data());
    a.getState().apply((d) => rename(d as never) as never);
    a.getState().setSelection('with_backing');
    a.getState().setDuet(true);
    jest.advanceTimersByTime(1000);
    const b = createReviewStore('j1', data());
    expect(b.getState().restoredFromDraft).toBe(true);
    expect(b.getState().doc.segments[0]!.text).toBe('HELLO');
    expect(b.getState().selection).toBe('with_backing');
    expect(b.getState().selectionTouched).toBe(true);
    expect(b.getState().doc.isDuet).toBe(true);
    expect(b.getState().isDuetTouched).toBe(true);
    expect(b.getState().editCount).toBe(2); // apply + setDuet
  });

  it('does not restore a draft over different audio, and deletes it', () => {
    const a = createReviewStore('j1', data('old'));
    a.getState().apply((d) => rename(d as never) as never);
    jest.advanceTimersByTime(1000);
    const b = createReviewStore('j1', data('new'));
    expect(b.getState().restoredFromDraft).toBe(false);
    expect(b.getState().doc.segments[0]!.text).toBe('hello');
    expect(require('../../storage').appStorage.getString('review-draft:j1')).toBeUndefined();
  });

  it('setDuet marks isDuetTouched and is undoable', () => {
    const store = createReviewStore('j1', data());
    expect(store.getState().isDuetTouched).toBe(false);
    store.getState().setDuet(true);
    expect(store.getState().doc.isDuet).toBe(true);
    expect(store.getState().isDuetTouched).toBe(true);
    store.getState().undoLast();
    expect(store.getState().doc.isDuet).toBe(false);
  });

  it('discard clears the draft and resets to server data', () => {
    const store = createReviewStore('j1', data());
    store.getState().apply((d) => rename(d as never) as never);
    store.getState().setSelection('clean');
    jest.advanceTimersByTime(1000);
    store.getState().discard();
    expect(store.getState().doc.segments[0]!.text).toBe('hello');
    expect(store.getState().editCount).toBe(0);
    expect(store.getState().selection).toBeNull();
    expect(store.getState().undo.canUndo).toBe(false);
    expect(loadDraft('j1', 'h1')).toBeNull();
    // A debounced save queued before discard must not resurrect the draft.
    store.getState().apply((d) => rename(d as never) as never);
    store.getState().discard();
    jest.advanceTimersByTime(2000);
    expect(loadDraft('j1', 'h1')).toBeNull();
  });
});

describe('drafts', () => {
  const draft = (audioHash: string | null): Draft => ({
    v: 1,
    audioHash,
    segments: [seg('a', 'x')],
    isDuet: false,
    selection: null,
    editCount: 3,
    savedAt: 1,
  });

  it('round-trips and clears', () => {
    saveDraft('j', draft('h'));
    expect(loadDraft('j', 'h')?.editCount).toBe(3);
    clearDraft('j');
    expect(loadDraft('j', 'h')).toBeNull();
  });

  it('a different hash returns null and deletes the draft', () => {
    saveDraft('j', draft('h'));
    expect(loadDraft('j', 'other')).toBeNull();
    expect(loadDraft('j', 'h')).toBeNull();
  });

  it('a null server hash only matches a null draft hash', () => {
    saveDraft('j', draft('h'));
    expect(loadDraft('j', null)).toBeNull();
    saveDraft('j', draft(null));
    expect(loadDraft('j', null)).not.toBeNull();
    saveDraft('j', draft(null));
    expect(loadDraft('j', 'h')).toBeNull();
  });

  it('drops corrupt or wrong-version drafts', () => {
    const { appStorage } = require('../../storage');
    appStorage.set('review-draft:j', '{nope');
    expect(loadDraft('j', 'h')).toBeNull();
    appStorage.set('review-draft:j', JSON.stringify({ ...draft('h'), v: 2 }));
    expect(loadDraft('j', 'h')).toBeNull();
    expect(appStorage.getString('review-draft:j')).toBeUndefined();
  });
});
