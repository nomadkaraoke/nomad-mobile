import { fireEvent, screen } from '@testing-library/react-native';

import type { ReviewPlayer } from '../../review/audio/useReviewPlayer';
import { LyricsStep } from '../../review/lyrics/LyricsStep';
import type { VocalsPeaks } from '../../review/lyrics/useVocalsPeaks';
import {
  cleanFixture,
  correctionsFixture,
  GAP,
  largeFixture,
  line,
  renderReview,
  reviewData,
  word,
  fakePlayer,
} from '../../test-utils/reviewFixtures';

jest.mock('../../review/audio/useReviewPlayer', () => ({}));

// The real List (FlashList, windowed by the jest layout mock), with scrollToIndex captured.
const mockScrollToIndex = jest.fn();
jest.mock('@nomad/ui', () => {
  const actual = jest.requireActual('@nomad/ui');
  const React = jest.requireActual('react');
  const List = React.forwardRef(function MockList(props: object, ref: unknown) {
    React.useImperativeHandle(ref, () => ({ scrollToIndex: mockScrollToIndex }));
    return React.createElement(actual.List, props);
  });
  return { ...actual, List };
});

const PEAKS: VocalsPeaks = { status: 'ready', peaks: [0.5], duration: 60 };

function renderStep(data = correctionsFixture(), playerOver: Record<string, unknown> = {}) {
  const player = fakePlayer(playerOver);
  const cb = {
    onEditLine: jest.fn(),
    onResync: jest.fn(),
    onNudge: jest.fn(),
    onWordPress: jest.fn(),
    onRequestText: jest.fn(),
    onNext: jest.fn(),
  };
  const ui = (p: typeof player) => (
    <LyricsStep player={p as unknown as ReviewPlayer} peaks={PEAKS} vocalsReady {...cb} />
  );
  const r = renderReview(ui(player), data);
  const rerenderWith = (over: Record<string, unknown>) => {
    Object.assign(player, over);
    r.rerenderUi(ui({ ...player }));
  };
  return { ...r, player, cb, rerenderWith };
}

const lineRows = () => screen.queryAllByTestId(/^review-line-\d+$/);

beforeEach(() => {
  mockScrollToIndex.mockReset();
  (jest.requireMock('react-native-mmkv') as { __resetMMKV(): void }).__resetMMKV();
});

describe('LyricsStep', () => {
  it('renders 300 lines without rendering every row, quickly', () => {
    const t0 = Date.now();
    renderStep(largeFixture(300));
    const ms = Date.now() - t0;
    expect(screen.getByTestId('review-step-lyrics')).toBeTruthy();
    expect(lineRows().length).toBeGreaterThan(0);
    expect(lineRows().length).toBeLessThan(300);
    expect(ms).toBeLessThan(1000);
  });

  it('tapping a line selects it and plays it from half a second before', () => {
    const { player } = renderStep();
    fireEvent.press(screen.getByTestId('review-line-0'));
    expect(player.playRange).toHaveBeenCalledWith(9.5, 13);
    expect(screen.getByTestId('review-tool-play')).toBeTruthy();
  });

  it('toolbar Edit / Re-sync / Nudge and word taps report to the screen', () => {
    const { cb } = renderStep();
    fireEvent.press(screen.getByTestId('review-line-2'));
    fireEvent.press(screen.getByTestId('review-tool-edit'));
    fireEvent.press(screen.getByTestId('review-tool-resync'));
    fireEvent.press(screen.getByTestId('review-tool-nudge'));
    fireEvent.press(screen.getByTestId('review-word-2-1'));
    expect(cb.onEditLine).toHaveBeenCalledWith(2);
    expect(cb.onResync).toHaveBeenCalledWith(2);
    expect(cb.onNudge).toHaveBeenCalledWith(2);
    expect(cb.onWordPress).toHaveBeenCalledWith(2, 1);
  });

  it('Delete removes the line (undoable) and clears the selection', () => {
    const { store } = renderStep();
    fireEvent.press(screen.getByTestId('review-line-0'));
    fireEvent.press(screen.getByTestId('review-tool-more'));
    fireEvent.press(screen.getByTestId('review-tool-delete'));
    expect(store.getState().doc.segments.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(store.getState().undo.canUndo).toBe(true);
    expect(screen.queryByTestId('review-tool-play')).toBeNull();
  });

  it('Merge joins the next line; Split cuts it in two', () => {
    const { store } = renderStep();
    fireEvent.press(screen.getByTestId('review-line-2'));
    fireEvent.press(screen.getByTestId('review-tool-more'));
    fireEvent.press(screen.getByTestId('review-tool-merge'));
    expect(store.getState().doc.segments[2]!.text).toBe('with you again because a vision');
    fireEvent.press(screen.getByTestId('review-tool-split'));
    expect(store.getState().doc.segments.map((s) => s.words.length)).toEqual([5, 4, 3, 3]);
  });

  it('Insert line after asks the screen for the new text', () => {
    const { cb } = renderStep();
    fireEvent.press(screen.getByTestId('review-line-1'));
    fireEvent.press(screen.getByTestId('review-tool-more'));
    fireEvent.press(screen.getByTestId('review-tool-insert'));
    expect(cb.onRequestText).toHaveBeenCalledWith({ kind: 'insertAfter', segment: 1 });
  });

  it('the CTA is disabled with an untimed word; pressing it goes to that word', () => {
    const { cb } = renderStep();
    const cta = screen.getByTestId('review-lyrics-next');
    expect(cta).toHaveTextContent('1 word needs timing');
    // Dimmed but still pressable (a disabled button could not jump): the hint says where it goes.
    expect(cta.props.accessibilityHint).toBe('Takes you to the first one');
    fireEvent.press(cta);
    expect(cb.onNext).not.toHaveBeenCalled();
    // Line 1 holds the untimed word: selected (toolbar open) and scrolled to.
    expect(screen.getByTestId('review-tool-play')).toBeTruthy();
    expect(mockScrollToIndex).toHaveBeenCalledWith(1, expect.objectContaining({ animated: true }));
  });

  it('with every word timed the CTA moves on', () => {
    const { cb } = renderStep(cleanFixture());
    expect(screen.getByTestId('review-lyrics-next')).toHaveTextContent('Lyrics look good');
    fireEvent.press(screen.getByTestId('review-lyrics-next'));
    expect(cb.onNext).toHaveBeenCalled();
  });

  it('the issues bar steps through issues: scroll, select, play from 1 s before', () => {
    const { player } = renderStep();
    expect(screen.getByTestId('review-issues-label')).toHaveTextContent('4 things to check');
    fireEvent.press(screen.getByTestId('review-issues-next'));
    expect(screen.getByTestId('review-issues-label')).toHaveTextContent('1 of 4 · Changed by AI');
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(0, expect.anything());
    expect(player.playRange).toHaveBeenLastCalledWith(10.7, 13);
    fireEvent.press(screen.getByTestId('review-issues-next'));
    expect(screen.getByTestId('review-issues-label')).toHaveTextContent('2 of 4 · Word needs timing');
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(1, expect.anything());
    // The gap callout sits before line 3: item 3 is the gap, item 4 the line.
    fireEvent.press(screen.getByTestId('review-issues-next'));
    fireEvent.press(screen.getByTestId('review-issues-next'));
    expect(screen.getByTestId('review-issues-label')).toHaveTextContent('4 of 4 · Possible missing lyrics');
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(3, expect.anything());
    expect(player.playRange).toHaveBeenLastCalledWith(23, 29);
  });

  it('shows no singer chips outside a duet', () => {
    renderStep();
    expect(screen.queryByTestId('review-line-0-singer')).toBeNull();
  });

  it('a duet chip press cycles the singer', () => {
    const { store } = renderStep(correctionsFixture({ is_duet: true }));
    const chip = () => screen.getByTestId('review-line-0-singer');
    expect(chip()).toHaveTextContent('1');
    fireEvent.press(chip());
    expect(store.getState().doc.segments[0]!.singer).toBe(2);
    fireEvent.press(chip());
    expect(store.getState().doc.segments[0]!.singer).toBe(0);
    expect(chip()).toHaveTextContent('Both');
    fireEvent.press(chip());
    expect(store.getState().doc.segments[0]!.singer).toBe(1);
  });

  it('a gap callout plays the gap and inserts the reference lines', () => {
    const { store, player } = renderStep();
    expect(screen.getByText('Possible missing lyrics · 0:24–0:29')).toBeTruthy();
    fireEvent.press(screen.getByTestId('review-gap-0-play'));
    expect(player.playRange).toHaveBeenLastCalledWith(23, 29.5);
    fireEvent.press(screen.getByTestId('review-gap-0-insert'));
    const texts = store.getState().doc.segments.map((s) => s.text);
    expect(texts).toContain('softly creeping');
    // The inserted words are untimed, so the gap is now "pending": it offers Sync timing instead.
    expect(screen.queryByTestId('review-gap-0-insert')).toBeNull();
  });

  it('a pending gap offers sync timing for its line', () => {
    const { cb } = renderStep();
    fireEvent.press(screen.getByTestId('review-gap-0-insert'));
    fireEvent.press(screen.getByTestId('review-gap-0-sync'));
    expect(cb.onResync).toHaveBeenCalledWith(3);
  });

  it('a gap without reference lyrics asks the screen for the words', () => {
    const gap = { ...GAP, reference_lines: {} };
    const { cb, store } = renderStep(correctionsFixture({ vocal_gaps: { gaps: [gap] } }));
    fireEvent.press(screen.getByTestId('review-gap-0-insert'));
    expect(cb.onRequestText).toHaveBeenCalledWith({ kind: 'gap', gap });
    expect(store.getState().editCount).toBe(0);
  });

  it('follows the active line while playing until the user scrolls by hand', () => {
    const { rerenderWith } = renderStep(cleanFixture());
    rerenderWith({ playing: true, position: 12.2 });
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(1, expect.objectContaining({ animated: true }));
    expect(screen.queryByTestId('review-player-follow')).toBeNull();

    fireEvent(screen.getByTestId('review-lines'), 'scrollBeginDrag');
    mockScrollToIndex.mockClear();
    rerenderWith({ position: 10.2 });
    expect(mockScrollToIndex).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('review-player-follow'));
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(0, expect.anything());
    expect(screen.queryByTestId('review-player-follow')).toBeNull();
  });

  it('holds auto-follow off for 1.5 s after a jump (a line tap), then follows again', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(100_000);
    const { rerenderWith } = renderStep(cleanFixture());
    rerenderWith({ playing: true, position: 10.2 });
    fireEvent.press(screen.getByTestId('review-line-1'));
    mockScrollToIndex.mockClear();
    rerenderWith({ position: 12.1 });
    expect(mockScrollToIndex).not.toHaveBeenCalled();
    now.mockReturnValue(101_600);
    rerenderWith({ position: 10.3 });
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(0, expect.anything());
    now.mockRestore();
  });

  it('auto-follow reacts to the active line changing, not to every tick', () => {
    const { rerenderWith } = renderStep(cleanFixture());
    rerenderWith({ playing: true, position: 10.2 });
    expect(mockScrollToIndex).toHaveBeenCalledTimes(1);
    rerenderWith({ position: 10.4 });
    rerenderWith({ position: 10.6 });
    expect(mockScrollToIndex).toHaveBeenCalledTimes(1);
  });

  it('highlights the active line', () => {
    const { rerenderWith } = renderStep(cleanFixture());
    rerenderWith({ playing: true, position: 12.7 });
    expect(screen.getByTestId('review-line-1').props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    expect(screen.getByTestId('review-word-1-1').props.accessibilityState).toEqual({ selected: true });
  });

  it('a line with all-null words renders without NaN', () => {
    renderStep(reviewData([line('n0', [word('n0a', 'lost', null, null)])]));
    expect(screen.getByTestId('review-word-0-0-untimed')).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
