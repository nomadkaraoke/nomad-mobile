import type { CorrectionData } from '@nomad/review-core';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { NudgeSheet } from '../../review/sheets/NudgeSheet';
import { REPEAT_DELAY_MS, REPEAT_INTERVAL_MS } from '../../review/sheets/useRepeatPress';
import { correctionsFixture, fakePlayer, line, renderReview, reviewData, word } from '../../test-utils/reviewFixtures';

function renderSheet(segment = 0, data: CorrectionData = correctionsFixture()) {
  const player = fakePlayer();
  const onClose = jest.fn();
  const onResyncRequested = jest.fn();
  const r = renderReview(
    <NudgeSheet segment={segment} player={player} onClose={onClose} onResyncRequested={onResyncRequested} />,
    data,
  );
  const seg = () => r.store.getState().doc.segments[segment]!;
  return { ...r, player, onClose, onResyncRequested, seg };
}

const disabled = (id: string) => screen.getByTestId(id).props.accessibilityState?.disabled === true;
const timings = (s: { words: { start_time: number | null; end_time: number | null }[] }) =>
  s.words.map((w) => [w.start_time, w.end_time]);

beforeEach(() => {
  jest.useRealTimers();
  (jest.requireMock('react-native-mmkv') as { __resetMMKV(): void }).__resetMMKV();
});

describe('NudgeSheet', () => {
  it('+0.1 s moves every word by 0.1 and replays the line ± 0.3 s', () => {
    const { seg, player } = renderSheet();
    const before = timings(seg());
    fireEvent.press(screen.getByTestId('review-nudge-line-plus'));
    timings(seg()).forEach(([s, e], i) => {
      expect(s).toBeCloseTo((before[i]![0] as number) + 0.1, 6);
      expect(e).toBeCloseTo((before[i]![1] as number) + 0.1, 6);
    });
    expect(player.playRange).toHaveBeenLastCalledWith(expect.closeTo(9.8, 6), expect.closeTo(13.4, 6));
    expect(screen.getByText('Start of line 0:10.10')).toBeTruthy();
  });

  it('moving the line is clamped at the next line', () => {
    const { seg } = renderSheet();
    let n = 0;
    while (!disabled('review-nudge-line-plus') && n < 50) {
      fireEvent.press(screen.getByTestId('review-nudge-line-plus'));
      n++;
    }
    // Line 0 ends at 13 and line 1 starts at 14: ten steps, then the button disables.
    expect(n).toBe(10);
    expect(seg().end_time).toBeCloseTo(14, 6);
    expect(seg().start_time).toBeCloseTo(11, 6);
    expect(disabled('review-nudge-line-minus')).toBe(false);
  });

  it('moving the first line earlier stops at 0', () => {
    const data = reviewData([line('a', [word('a0', 'hi', 0.15, 0.5)]), line('b', [word('b0', 'yo', 2, 3)])]);
    const { seg } = renderSheet(0, data);
    fireEvent.press(screen.getByTestId('review-nudge-line-minus'));
    fireEvent.press(screen.getByTestId('review-nudge-line-minus'));
    expect(seg().start_time).toBe(0);
    expect(disabled('review-nudge-line-minus')).toBe(true);
  });

  it('Start / End of line step the first and last words by 0.05 s', () => {
    const { seg } = renderSheet();
    fireEvent.press(screen.getByTestId('review-nudge-start-plus'));
    fireEvent.press(screen.getByTestId('review-nudge-end-minus'));
    expect(seg().words[0]).toMatchObject({ start_time: 10.05, end_time: 10.5 });
    expect(seg().words[4]).toMatchObject({ start_time: 12.3, end_time: 12.95 });
    expect(seg()).toMatchObject({ start_time: 10.05, end_time: 12.95 });
    fireEvent.press(screen.getByTestId('review-nudge-start-minus'));
    fireEvent.press(screen.getByTestId('review-nudge-end-plus'));
    expect(seg()).toMatchObject({ start_time: 10, end_time: 13 });
  });

  it('a held step repeats (fake timers): several applies, one replay', () => {
    jest.useFakeTimers();
    const { store, player, seg } = renderSheet();
    const btn = screen.getByTestId('review-nudge-line-minus');
    fireEvent(btn, 'pressIn');
    act(() => jest.advanceTimersByTime(REPEAT_DELAY_MS + REPEAT_INTERVAL_MS * 4));
    fireEvent(btn, 'pressOut');
    expect(seg().start_time).toBeCloseTo(9.5, 6);
    expect(store.getState().editCount).toBe(1);
    expect(player.playRange).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('a held step stops repeating at the clamp', () => {
    jest.useFakeTimers();
    const { store, player } = renderSheet();
    const btn = screen.getByTestId('review-nudge-line-plus');
    fireEvent(btn, 'pressIn');
    act(() => jest.advanceTimersByTime(REPEAT_DELAY_MS + REPEAT_INTERVAL_MS * 30));
    expect(store.getState().doc.segments[0]!.end_time).toBe(14);
    expect(store.getState().editCount).toBe(1);
    // It replayed when it hit the clamp; the release does not replay again.
    expect(player.playRange).toHaveBeenCalledTimes(1);
    fireEvent(btn, 'pressOut');
    expect(player.playRange).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('holding for 30 steps is one undo: undo once restores the pre-hold doc', () => {
    jest.useFakeTimers();
    const data = reviewData([line('a', [word('a0', 'hi', 10, 10.5), word('a1', 'yo', 10.6, 11)])]);
    const { store } = renderSheet(0, data);
    const before = store.getState().doc;
    const btn = screen.getByTestId('review-nudge-line-plus');
    fireEvent(btn, 'pressIn');
    act(() => jest.advanceTimersByTime(REPEAT_DELAY_MS + REPEAT_INTERVAL_MS * 29));
    fireEvent(btn, 'pressOut');
    expect(store.getState().doc.segments[0]!.start_time).toBeCloseTo(13, 6); // 30 × 0.1 s
    act(() => store.getState().undoLast());
    expect(store.getState().doc).toBe(before);
    expect(store.getState().undo.canUndo).toBe(false);
    jest.useRealTimers();
  });

  it('a line with no timing shows "No timing yet" and offers Re-sync', () => {
    const data = reviewData([line('a', [word('a0', 'la', null, null), word('a1', 'la', null, null)])]);
    const { onResyncRequested } = renderSheet(0, data);
    expect(screen.getByText('No timing yet')).toBeTruthy();
    expect(screen.queryByTestId('review-nudge-line-plus')).toBeNull();
    fireEvent.press(screen.getByTestId('review-nudge-resync'));
    expect(onResyncRequested).toHaveBeenCalledWith(0);
  });

  it('closes when the line is gone', () => {
    const { onClose } = renderSheet(9);
    expect(onClose).toHaveBeenCalled();
  });
});
