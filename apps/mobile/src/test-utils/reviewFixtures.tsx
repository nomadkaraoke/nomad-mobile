// Correction-doc fixtures (shaped like gen's local-stack review fixtures) and a render helper for review tests.
import { IntlProvider } from '@nomad/i18n';
import type { CorrectionData, LyricsSegment, VocalGap, Word } from '@nomad/review-core';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { createReviewStore, ReviewStoreContext } from '../review/store';

export const word = (id: string, text: string, start: number | null, end: number | null, extra: Partial<Word> = {}): Word => ({
  id,
  text,
  start_time: start,
  end_time: end,
  ...extra,
});

/** A segment whose text and bounds come from its words. */
export function line(id: string, words: Word[], extra: Partial<LyricsSegment> = {}): LyricsSegment {
  const timed = words.filter((w) => w.start_time !== null && w.end_time !== null);
  return {
    id,
    text: words.map((w) => w.text).join(' '),
    words,
    start_time: timed.length ? timed[0]!.start_time : null,
    end_time: timed.length ? timed[timed.length - 1]!.end_time : null,
    ...extra,
  };
}

export function reviewData(segments: LyricsSegment[], over: Partial<CorrectionData> = {}): CorrectionData {
  return {
    original_segments: [],
    reference_lyrics: {},
    anchor_sequences: [],
    gap_sequences: [],
    resized_segments: [],
    corrections_made: 0,
    confidence: 1,
    corrections: [],
    corrected_segments: segments,
    metadata: {
      anchor_sequences_count: 0,
      gap_sequences_count: 0,
      total_words: segments.reduce((n, s) => n + s.words.length, 0),
      correction_ratio: 0,
      audio_hash: 'h1',
      artist: 'Simon & Garfunkel',
      title: 'The Sound of Silence',
    },
    correction_steps: [],
    word_id_map: {},
    segment_id_map: {},
    ...over,
  };
}

export const GAP: VocalGap = {
  start: 24,
  end: 29,
  duration: 5,
  active_fraction: 0.9,
  longest_run_s: 4,
  reference_lines: { genius: ['softly creeping'] },
  suspect: true,
  evidenced: true,
};

/**
 * Like gen's `corrections` fixture: an AI-corrected word (11.7 s), one untimed word (line 1),
 * an estimated word (21 s) and an evidenced vocal gap (24–29 s) before the last line.
 */
export function correctionsFixture(over: Partial<CorrectionData> = {}): CorrectionData {
  return reviewData(
    [
      line('s0', [
        word('w0', 'Hello', 10, 10.5),
        word('w1', 'darkness', 10.6, 11.2),
        word('w2', 'my', 11.3, 11.6),
        word('w3', 'old', 11.7, 12.2, { ai_corrected: true, original_text: 'gold', correction_span_id: 'sp1' }),
        word('w4', 'friend', 12.3, 13),
      ]),
      line('s1', [word('w5', "I've", 14, 14.4), word('w6', 'come', 14.5, 14.9), word('w7', 'to', 15, 15.3), word('w8', 'talk', null, null)]),
      line('s2', [word('w9', 'with', 20, 20.4), word('w10', 'you', 20.5, 20.9), word('w11', 'again', 21, 21.8, { timing_estimated: true })]),
      line('s3', [word('w12', 'because', 30, 30.5), word('w13', 'a', 30.6, 30.8), word('w14', 'vision', 30.9, 31.5)]),
    ],
    { vocal_gaps: { gaps: [GAP] }, ...over },
  );
}

/** Every word timed, nothing to check. */
export function cleanFixture(over: Partial<CorrectionData> = {}): CorrectionData {
  return reviewData(
    [
      line('c0', [word('c0a', 'Hello', 10, 10.5), word('c0b', 'darkness', 10.6, 11.2)]),
      line('c1', [word('c1a', 'my', 12, 12.5), word('c1b', 'friend', 12.6, 13)]),
    ],
    over,
  );
}

/** Like gen's `large` fixture: `n` lines of 7 words, 3 s apart. */
export function largeFixture(n = 300): CorrectionData {
  const segments = Array.from({ length: n }, (_, i) =>
    line(
      `L${i}`,
      Array.from({ length: 7 }, (_, j) => word(`L${i}w${j}`, `word${j}`, i * 3 + j * 0.4, i * 3 + j * 0.4 + 0.3)),
    ),
  );
  return reviewData(segments);
}

/** A Hebrew line inside an English song. */
export function rtlFixture(): CorrectionData {
  return reviewData([
    line('r0', [word('r0a', 'Hello', 1, 1.5), word('r0b', 'world', 1.6, 2)]),
    line('r1', [word('r1a', 'שלום', 3, 3.5), word('r1b', 'עולם', 3.6, 4)]),
  ]);
}

/** Renders `ui` inside English i18n and a fresh review store for `data`. */
export function renderReview(ui: ReactElement, data: CorrectionData, jobId = 'j1') {
  const store = createReviewStore(jobId, data);
  const wrap = (el: ReactElement) => (
    <IntlProvider locale="en">
      <ReviewStoreContext.Provider value={store}>{el}</ReviewStoreContext.Provider>
    </IntlProvider>
  );
  const utils = render(wrap(ui));
  /** Re-render with new props, inside the same providers and store. */
  const rerenderUi = (el: ReactElement) => utils.rerender(wrap(el));
  return { store, ...utils, rerenderUi };
}

/** A stand-in for useReviewPlayer: every command is a jest.fn; tests mutate the state fields. */
export function fakePlayer(over: Record<string, unknown> = {}) {
  return {
    play: jest.fn(),
    pause: jest.fn(),
    toggle: jest.fn(),
    seekTo: jest.fn(async () => {}),
    setRate: jest.fn(),
    rate: 1,
    source: 'song' as 'song' | 'vocals',
    setSource: jest.fn(),
    playing: false,
    loaded: true,
    position: 0,
    duration: 60,
    now: jest.fn(() => 0),
    playRange: jest.fn(),
    error: null as 'load_failed' | 'play_failed' | null,
    ...over,
  };
}
