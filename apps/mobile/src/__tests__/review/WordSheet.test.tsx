import type { CorrectionData } from '@nomad/review-core';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { REPEAT_DELAY_MS, REPEAT_INTERVAL_MS } from '../../review/sheets/useRepeatPress';
import { WordSheet } from '../../review/sheets/WordSheet';
import { correctionsFixture, fakePlayer, line, renderReview, reviewData, word } from '../../test-utils/reviewFixtures';

/** "teh night": 1–1.5 s and 1.6–2 s. */
const tehData = () => reviewData([line('a', [word('a0', 'teh', 1, 1.5), word('a1', 'night', 1.6, 2)])]);

function renderSheet(data: CorrectionData, segment = 0, wordIndex = 0) {
  const player = fakePlayer();
  const onClose = jest.fn();
  const onResyncRequested = jest.fn();
  const r = renderReview(
    <WordSheet segment={segment} word={wordIndex} player={player} onClose={onClose} onResyncRequested={onResyncRequested} />,
    data,
  );
  const words = () => r.store.getState().doc.segments[segment]!.words;
  return { ...r, player, onClose, onResyncRequested, words };
}

const disabled = (id: string) => screen.getByTestId(id).props.accessibilityState?.disabled === true;

/** Presses `id` until it disables (a clamp), at most `max` times. Returns how many presses changed something. */
function pressUntilDisabled(id: string, max = 50) {
  let n = 0;
  while (!disabled(id) && n < max) {
    fireEvent.press(screen.getByTestId(id));
    n++;
  }
  return n;
}

beforeEach(() => {
  jest.useRealTimers();
  (jest.requireMock('react-native-mmkv') as { __resetMMKV(): void }).__resetMMKV();
});

describe('WordSheet', () => {
  it('"teh" → "the" saves the text and keeps the timing', () => {
    const { words, onClose } = renderSheet(tehData());
    expect(screen.getByTestId('review-word-input').props.value).toBe('teh');
    fireEvent.changeText(screen.getByTestId('review-word-input'), 'the');
    fireEvent.press(screen.getByTestId('review-word-save'));
    expect(words()[0]).toMatchObject({ text: 'the', start_time: 1, end_time: 1.5 });
    expect(words()[0]!.timing_estimated).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('saving the unchanged word is not an edit', () => {
    const { store, onClose } = renderSheet(tehData());
    fireEvent.press(screen.getByTestId('review-word-save'));
    expect(store.getState().editCount).toBe(0);
    expect(onClose).toHaveBeenCalled();
  });

  it('"rock and" splits the word into two with estimated timing', () => {
    const { words } = renderSheet(tehData());
    fireEvent.changeText(screen.getByTestId('review-word-input'), 'rock and');
    fireEvent.press(screen.getByTestId('review-word-save'));
    expect(words().map((w) => [w.text, w.start_time, w.end_time, w.timing_estimated])).toEqual([
      ['rock', 1, 1.25, true],
      ['and', 1.25, 1.5, true],
      ['night', 1.6, 2, undefined],
    ]);
  });

  it('an empty text deletes the word', () => {
    const { words, onClose } = renderSheet(tehData());
    fireEvent.changeText(screen.getByTestId('review-word-input'), '   ');
    fireEvent.press(screen.getByTestId('review-word-save'));
    expect(words().map((w) => w.text)).toEqual(['night']);
    expect(onClose).toHaveBeenCalled();
  });

  it('Delete removes the word; Merge joins it with the next and stays open', () => {
    const merged = renderSheet(tehData());
    fireEvent.press(screen.getByTestId('review-word-merge'));
    expect(merged.words()).toHaveLength(1);
    expect(merged.words()[0]).toMatchObject({ text: 'teh night', start_time: 1, end_time: 2 });
    expect(screen.getByTestId('review-word-input').props.value).toBe('teh night');
    expect(disabled('review-word-merge')).toBe(true); // no next word now
    expect(merged.onClose).not.toHaveBeenCalled();
    merged.unmount();

    const deleted = renderSheet(tehData());
    fireEvent.press(screen.getByTestId('review-word-delete'));
    expect(deleted.words().map((w) => w.text)).toEqual(['night']);
    expect(deleted.onClose).toHaveBeenCalled();
  });

  it('start + is clamped at the next word, and each step replays the word ± 0.3 s', () => {
    const { words, player } = renderSheet(tehData());
    fireEvent.press(screen.getByTestId('review-word-start-plus'));
    expect(words()[0]!.start_time).toBeCloseTo(1.05, 6);
    expect(player.playRange).toHaveBeenLastCalledWith(expect.closeTo(0.75, 6), expect.closeTo(1.8, 6));
    expect(screen.getByText('Start 0:01.05')).toBeTruthy();

    pressUntilDisabled('review-word-start-plus');
    // start ≤ next word's start − 0.05, end ≤ next word's start.
    expect(words()[0]!.start_time).toBeCloseTo(1.55, 6);
    expect(words()[0]!.end_time).toBeCloseTo(1.6, 6);
    expect(disabled('review-word-start-plus')).toBe(true);
    expect(disabled('review-word-end-plus')).toBe(true);
  });

  it('end − is clamped at start + 0.05', () => {
    const { words } = renderSheet(tehData());
    const n = pressUntilDisabled('review-word-end-minus');
    expect(n).toBe(9); // 1.5 → 1.05
    expect(words()[0]!.end_time).toBeCloseTo(1.05, 6);
    expect(words()[0]!.start_time).toBe(1);
    expect(disabled('review-word-end-minus')).toBe(true);
    // start − is free (nothing before it but 0).
    expect(disabled('review-word-start-minus')).toBe(false);
  });

  it('revert AI restores the original span from undo_info', () => {
    const data = correctionsFixture();
    data.metadata = {
      ...data.metadata,
      auto_approval: {
        pre_applied: true,
        undo_info: {
          sp1: {
            op: 'replace',
            new_word_ids: ['w3'],
            removed_words: [word('o3', 'gold', 11.7, 12.2)],
            segment_id: 's0',
            prev_word_id: null,
            removed_segment: null,
          },
        },
      },
    };
    const { words, onClose } = renderSheet(data, 0, 3);
    expect(screen.getByText('Changed by AI from “gold”')).toBeTruthy();
    fireEvent.press(screen.getByTestId('review-word-revert-ai'));
    expect(words().map((w) => w.text)).toEqual(['Hello', 'darkness', 'my', 'gold', 'friend']);
    expect(words()[3]!.ai_corrected).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('revert AI is disabled without undo info', () => {
    renderSheet(correctionsFixture(), 0, 3);
    expect(screen.getByText('Changed by AI from “gold”')).toBeTruthy();
    expect(disabled('review-word-revert-ai')).toBe(true);
  });

  it('an untimed word shows "No timing yet" and offers Re-sync instead of steps', () => {
    const { onResyncRequested } = renderSheet(correctionsFixture(), 1, 3);
    expect(screen.getByText('No timing yet')).toBeTruthy();
    expect(screen.queryByTestId('review-word-start-plus')).toBeNull();
    fireEvent.press(screen.getByTestId('review-word-resync'));
    expect(onResyncRequested).toHaveBeenCalledWith(1);
  });

  it('long-press repeats the step every 120 ms after 400 ms, and replays once on release', () => {
    jest.useFakeTimers();
    const { store, player, words } = renderSheet(tehData());
    const btn = screen.getByTestId('review-word-start-minus');
    fireEvent(btn, 'pressIn');
    act(() => jest.advanceTimersByTime(REPEAT_DELAY_MS + REPEAT_INTERVAL_MS * 3));
    fireEvent(btn, 'pressOut');
    fireEvent(btn, 'press'); // the release's own press is not another step
    expect(store.getState().editCount).toBe(4);
    expect(words()[0]!.start_time).toBeCloseTo(0.8, 6);
    expect(player.playRange).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(1000));
    expect(store.getState().editCount).toBe(4);
    jest.useRealTimers();
  });

  it('closes when the word is gone', () => {
    const { onClose } = renderSheet(tehData(), 0, 5);
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('review-word-input')).toBeNull();
  });
});
