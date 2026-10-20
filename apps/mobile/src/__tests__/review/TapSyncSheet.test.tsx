import type { CorrectionData } from '@nomad/review-core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import * as latency from '../../review/sync/latency';
import { TapSyncSheet } from '../../review/sync/TapSyncSheet';
import { correctionsFixture, fakePlayer, line, renderReview, reviewData, word } from '../../test-utils/reviewFixtures';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => {}) }));

let pressClock: jest.SpyInstance<number, []>;

beforeEach(() => {
  jest.useRealTimers();
  (jest.requireMock('react-native-mmkv') as { __resetMMKV(): void }).__resetMMKV();
  pressClock = jest.spyOn(latency, 'pressClockMs');
  (Haptics.selectionAsync as jest.Mock).mockClear();
});
afterEach(() => jest.restoreAllMocks());

async function renderSheet(segment = 0, opts: { data?: CorrectionData; keepGoing?: boolean; rate?: number } = {}) {
  const player = fakePlayer({ rate: opts.rate ?? 1 });
  const onClose = jest.fn();
  const r = renderReview(
    <TapSyncSheet segment={segment} keepGoing={opts.keepGoing} player={player} onClose={onClose} />,
    opts.data ?? correctionsFixture(),
  );
  // The lead-in seek resolves, then playback starts.
  await waitFor(() => expect(player.play).toHaveBeenCalled());
  const seg = (i = segment) => r.store.getState().doc.segments[i]!;
  return { ...r, player, onClose, seg };
}

/** One press on the pad: finger down at player time `at`, up at `upAt` after `heldMs`. */
function tap(player: ReturnType<typeof fakePlayer>, at: number, opts: { upAt?: number; heldMs?: number } = {}) {
  const heldMs = opts.heldMs ?? 80;
  player.now.mockReturnValueOnce(at).mockReturnValueOnce(opts.upAt ?? at + heldMs / 1000);
  pressClock.mockReturnValueOnce(1000).mockReturnValueOnce(1000 + heldMs);
  act(() =>
    fireGestureHandler(getByGestureTestId('review-sync-pad'), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]),
  );
}

/** Drive one side of the pad gesture directly (fireGestureHandler always runs a full press). */
function padBegin(player: ReturnType<typeof fakePlayer>, at: number, clockMs = 1000) {
  const g = getByGestureTestId('review-sync-pad') as unknown as { handlers: { onBegin: (e: unknown) => void } };
  player.now.mockReturnValueOnce(at);
  pressClock.mockReturnValueOnce(clockMs);
  act(() => g.handlers.onBegin({}));
}
function padFinalize(player: ReturnType<typeof fakePlayer>, at: number, clockMs: number) {
  const g = getByGestureTestId('review-sync-pad') as unknown as { handlers: { onFinalize: (e: unknown, ok: boolean) => void } };
  player.now.mockReturnValueOnce(at);
  pressClock.mockReturnValueOnce(clockMs);
  act(() => g.handlers.onFinalize({}, true));
}

const timings = (s: { words: { start_time: number | null; end_time: number | null }[] }) =>
  s.words.map((w) => [w.start_time, w.end_time]);

describe('TapSyncSheet', () => {
  it('opens with a 3 s lead-in: seeks to start − 3 and plays at 1×', async () => {
    const { player } = await renderSheet(0);
    expect(screen.getByTestId('review-sync-sheet')).toBeTruthy();
    expect(player.seekTo).toHaveBeenCalledWith(7);
    expect(player.seekTo.mock.invocationCallOrder[0]!).toBeLessThan(player.play.mock.invocationCallOrder[0]!);
    expect(screen.getByTestId('review-sync-current-word')).toHaveTextContent('Hello');
    expect(screen.getByText('darkness my old friend')).toBeTruthy();
  });

  it('the lead-in is floored at 0', async () => {
    const data = reviewData([line('a', [word('a0', 'hi', 1, 1.5), word('a1', 'yo', 1.6, 2)])]);
    const { player } = await renderSheet(0, { data });
    expect(player.seekTo).toHaveBeenCalledWith(0);
  });

  it('taps set each word start, gap-fill the previous word, and Done commits once', async () => {
    const { player, store, seg, onClose } = await renderSheet(0);
    const before = store.getState().doc;
    [10.1, 10.7, 11.4, 11.8, 12.4].forEach((t) => tap(player, t));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(5);
    // Nothing is written until Done.
    expect(store.getState().doc).toBe(before);
    fireEvent.press(screen.getByTestId('review-sync-done'));
    const got = timings(seg());
    const want = [
      [10.1, 10.69],
      [10.7, 11.39],
      [11.4, 11.79],
      [11.8, 12.39],
      // A tap is gap-filled by 1.0 s (the next line starts at 14, so no cap applies).
      [12.4, 13.4],
    ];
    got.forEach(([s, e], i) => {
      expect(s).toBeCloseTo(want[i]![0]!, 6);
      expect(e).toBeCloseTo(want[i]![1]!, 6);
    });
    expect(store.getState().editCount).toBe(1);
    expect(onClose).toHaveBeenCalled();
    act(() => store.getState().undoLast());
    expect(store.getState().doc).toBe(before);
  });

  it('a 600 ms hold keeps its release time', async () => {
    const { player, seg } = await renderSheet(0);
    tap(player, 10.1, { upAt: 10.9, heldMs: 600 });
    [11, 11.5, 12, 12.4].forEach((t) => tap(player, t));
    fireEvent.press(screen.getByTestId('review-sync-done'));
    expect(seg().words[0]!.start_time).toBeCloseTo(10.1, 6);
    expect(seg().words[0]!.end_time).toBeCloseTo(10.9, 6);
  });

  it('stamps from player.now(), with no latency correction by default', async () => {
    expect(latency.TAP_LATENCY_S).toEqual({ ios: 0, android: 0 });
    const { player, seg } = await renderSheet(0);
    tap(player, 10.25);
    fireEvent.press(screen.getByTestId('review-sync-done'));
    expect(seg().words[0]!.start_time).toBeCloseTo(10.25, 6);
  });

  it('subtracts the platform output latency from press and release', async () => {
    jest.spyOn(latency, 'tapLatencyFor').mockReturnValue(0.1);
    const { player, seg } = await renderSheet(0);
    tap(player, 10.25, { upAt: 10.5, heldMs: 250 });
    fireEvent.press(screen.getByTestId('review-sync-done'));
    expect(seg().words[0]!.start_time).toBeCloseTo(10.15, 6);
    expect(seg().words[0]!.end_time).toBeCloseTo(10.4, 6);
  });

  it('shows the progress: the current word moves on and synced words are marked', async () => {
    const { player } = await renderSheet(0);
    tap(player, 10.1);
    tap(player, 10.7);
    expect(screen.getByTestId('review-sync-current-word')).toHaveTextContent('my');
    expect(screen.getByTestId('review-sync-word-0').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('review-sync-word-2').props.accessibilityState).toEqual({ selected: false });
  });

  it('Restart resets the pass and re-seeks to the lead-in', async () => {
    const { player, store, onClose } = await renderSheet(0);
    const before = store.getState().doc;
    tap(player, 10.1);
    tap(player, 10.7);
    player.seekTo.mockClear();
    player.play.mockClear();
    fireEvent.press(screen.getByTestId('review-sync-restart'));
    await waitFor(() => expect(player.play).toHaveBeenCalled());
    expect(player.seekTo).toHaveBeenCalledWith(7);
    expect(screen.getByTestId('review-sync-current-word')).toHaveTextContent('Hello');
    // Nothing synced after the restart: Done leaves the doc alone.
    fireEvent.press(screen.getByTestId('review-sync-done'));
    expect(store.getState().doc).toBe(before);
    expect(onClose).toHaveBeenCalled();
  });

  it('after the last word it stops and offers Play it back / Redo', async () => {
    const { player } = await renderSheet(0);
    expect(screen.queryByTestId('review-sync-playback')).toBeNull();
    [10.1, 10.7, 11.4, 11.8].forEach((t) => tap(player, t));
    player.pause.mockClear();
    tap(player, 12.4, { upAt: 12.95, heldMs: 550 });
    expect(player.pause).toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('review-sync-playback'));
    // The re-synced line, ± 0.3 s.
    expect(player.playRange).toHaveBeenLastCalledWith(expect.closeTo(9.8, 6), expect.closeTo(13.25, 6));
    player.seekTo.mockClear();
    fireEvent.press(screen.getByTestId('review-sync-redo'));
    expect(player.seekTo).toHaveBeenCalledWith(7);
    expect(screen.getByTestId('review-sync-current-word')).toHaveTextContent('Hello');
  });

  it('auto-stops one second after the line end', async () => {
    jest.useFakeTimers();
    const { player } = await renderSheet(0);
    player.now.mockReturnValue(13.5);
    act(() => jest.advanceTimersByTime(200));
    expect(player.pause).not.toHaveBeenCalled();
    player.now.mockReturnValue(14.05);
    act(() => jest.advanceTimersByTime(200));
    expect(player.pause).toHaveBeenCalled();
    expect(screen.getByTestId('review-sync-redo')).toBeTruthy();
    jest.useRealTimers();
  });

  it('with "keep going" the next line loads after the last word, without re-seeking; Done commits both', async () => {
    const { player, store, seg } = await renderSheet(0, { keepGoing: true });
    expect(screen.getByTestId('review-sync-continue').props.value).toBe(true);
    [10.1, 10.7, 11.4, 11.8, 12.4].forEach((t) => tap(player, t));
    expect(screen.getByTestId('review-sync-current-word')).toHaveTextContent("I've");
    expect(player.seekTo).toHaveBeenCalledTimes(1);
    expect(player.pause).not.toHaveBeenCalled();
    // Line 1 has an untimed last word ("talk"): the pass times it.
    [14.1, 14.6, 15.1, 15.5].forEach((t) => tap(player, t));
    fireEvent.press(screen.getByTestId('review-sync-done'));
    expect(seg(0).words[0]!.start_time).toBeCloseTo(10.1, 6);
    expect(seg(1).words.map((w) => w.start_time)).toEqual([14.1, 14.6, 15.1, 15.5]);
    // "talk" gap-fills 1 s, capped before the next line (20).
    expect(seg(1).words[3]!.end_time).toBeCloseTo(16.5, 6);
    expect(store.getState().editCount).toBe(1);
  });

  it('"keep going" is off by default and can be turned on mid-pass', async () => {
    const { player } = await renderSheet(0);
    const toggle = screen.getByTestId('review-sync-continue');
    expect(toggle.props.value).toBe(false);
    fireEvent(toggle, 'valueChange', true);
    [10.1, 10.7, 11.4, 11.8, 12.4].forEach((t) => tap(player, t));
    expect(screen.getByTestId('review-sync-current-word')).toHaveTextContent("I've");
  });

  it('closing without Done leaves the doc unchanged (no undo push) and restores the speed', async () => {
    const { player, store, onClose, unmount } = await renderSheet(0, { rate: 0.75 });
    const before = store.getState().doc;
    expect(player.setRate).toHaveBeenCalledWith(1);
    tap(player, 10.1);
    fireEvent.press(screen.getByTestId('review-sync-sheet-backdrop'));
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(store.getState().doc).toBe(before);
    expect(store.getState().undo.canUndo).toBe(false);
    expect(player.pause).toHaveBeenCalled();
    expect(player.setRate).toHaveBeenLastCalledWith(0.75);
  });

  it('the speed button cycles 1× → 0.75× → 0.5× → 1×', async () => {
    const { player } = await renderSheet(0);
    const rate = () => screen.getByTestId('review-sync-rate');
    fireEvent.press(rate());
    expect(player.setRate).toHaveBeenLastCalledWith(0.75);
    fireEvent.press(rate());
    expect(player.setRate).toHaveBeenLastCalledWith(0.5);
    expect(rate()).toHaveTextContent('0.5×');
    fireEvent.press(rate());
    expect(player.setRate).toHaveBeenLastCalledWith(1);
  });

  it('a fully untimed line takes its window from its neighbours', async () => {
    const data = reviewData([
      line('a', [word('a0', 'hi', 5, 6)]),
      line('b', [word('b0', 'la', null, null), word('b1', 'la', null, null)]),
      line('c', [word('c0', 'yo', 12, 13)]),
    ]);
    const { player, seg } = await renderSheet(1, { data });
    expect(player.seekTo).toHaveBeenCalledWith(3);
    tap(player, 7);
    tap(player, 8);
    fireEvent.press(screen.getByTestId('review-sync-done'));
    expect(timings(seg(1))).toEqual([
      [7, expect.closeTo(7.99, 6)],
      [8, 9],
    ]);
  });

  it('keep going: a held last word past the next line\'s OLD start keeps its release (lines commit last-first)', async () => {
    const { player, seg } = await renderSheet(0, { keepGoing: true });
    [10.1, 10.7, 11.4, 11.8].forEach((t) => tap(player, t));
    // Line 1 used to start at 14; this hold runs to 14.3.
    tap(player, 12.4, { upAt: 14.3, heldMs: 1900 });
    [14.5, 14.8, 15.1, 15.4].forEach((t) => tap(player, t));
    fireEvent.press(screen.getByTestId('review-sync-done'));
    expect(seg(0).words[4]!.end_time).toBeCloseTo(14.3, 6);
    expect(seg(1).words[0]!.start_time).toBeCloseTo(14.5, 6);
  });

  it('keep going: a next line re-tapped earlier than the gap-fill leaves no overlap', async () => {
    const { player, seg } = await renderSheet(0, { keepGoing: true });
    [10.1, 10.7, 11.4, 11.8, 12.4].forEach((t) => tap(player, t));
    [13.2, 13.6, 14, 14.4].forEach((t) => tap(player, t));
    fireEvent.press(screen.getByTestId('review-sync-done'));
    expect(seg(0).words[4]!.end_time).toBeCloseTo(13.19, 6);
    expect(seg(0).end_time!).toBeLessThanOrEqual(seg(1).start_time!);
  });

  it('Done during a hold ends the held word now (no zero-length word)', async () => {
    const { player, seg } = await renderSheet(0);
    padBegin(player, 10.1, 1000);
    player.now.mockReturnValueOnce(10.45);
    pressClock.mockReturnValueOnce(1350);
    fireEvent.press(screen.getByTestId('review-sync-done'));
    expect(seg().words[0]!.start_time).toBeCloseTo(10.1, 6);
    expect(seg().words[0]!.end_time).toBeCloseTo(10.45, 6);
  });

  it('does not auto-stop while a word is held; stops once it is released', async () => {
    jest.useFakeTimers();
    const { player } = await renderSheet(0);
    padBegin(player, 10.1, 1000);
    player.now.mockReturnValue(14.5);
    act(() => jest.advanceTimersByTime(200));
    expect(player.pause).not.toHaveBeenCalled();
    padFinalize(player, 14.5, 5400);
    act(() => jest.advanceTimersByTime(100));
    expect(player.pause).toHaveBeenCalled();
    expect(screen.getByTestId('review-sync-current-word')).toHaveTextContent('Stopped after the line');
    jest.useRealTimers();
  });

  it('Play it back is hidden when nothing was synced', async () => {
    jest.useFakeTimers();
    const { player } = await renderSheet(0);
    player.now.mockReturnValue(14.5);
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByTestId('review-sync-redo')).toBeTruthy();
    expect(screen.queryByTestId('review-sync-playback')).toBeNull();
    jest.useRealTimers();
  });

  it('Play it back follows the heard line across every synced line', async () => {
    const { player, rerenderUi, onClose } = await renderSheet(0, { keepGoing: true });
    [10.1, 10.7, 11.4, 11.8, 12.4].forEach((t) => tap(player, t));
    [14.1, 14.6, 15.1].forEach((t) => tap(player, t));
    // Stop after line 1.
    fireEvent(screen.getByTestId('review-sync-continue'), 'valueChange', false);
    tap(player, 15.5, { upAt: 16, heldMs: 500 });
    expect(screen.getByTestId('review-sync-playback')).toBeTruthy();
    const show = (position: number) =>
      rerenderUi(<TapSyncSheet segment={0} keepGoing player={{ ...player, playing: true, position }} onClose={onClose} />);
    show(10.3);
    expect(screen.getByTestId('review-sync-word-0')).toHaveTextContent('Hello');
    expect(screen.getByTestId('review-sync-word-0').props.className).toMatch(/bg-primary/);
    show(14.7);
    expect(screen.getByTestId('review-sync-word-0')).toHaveTextContent("I've");
    expect(screen.getByTestId('review-sync-word-1').props.className).toMatch(/bg-primary/);
  });
});
