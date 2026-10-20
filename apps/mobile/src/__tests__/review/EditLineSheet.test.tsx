import type { CorrectionData } from '@nomad/review-core';
import { fireEvent, screen } from '@testing-library/react-native';

import { EditLineSheet, type EditLineTarget } from '../../review/sheets/EditLineSheet';
import { correctionsFixture, GAP, renderReview } from '../../test-utils/reviewFixtures';

function renderSheet(target: EditLineTarget, data: CorrectionData = correctionsFixture(), audioDuration?: number) {
  const onClose = jest.fn();
  const onResyncRequested = jest.fn();
  const r = renderReview(
    <EditLineSheet target={target} onClose={onClose} onResyncRequested={onResyncRequested} audioDuration={audioDuration} />,
    data,
  );
  const segs = () => r.store.getState().doc.segments;
  return { ...r, onClose, onResyncRequested, segs };
}

const type = (text: string) => fireEvent.changeText(screen.getByTestId('review-line-input'), text);
const save = () => fireEvent.press(screen.getByTestId('review-line-save'));
const disabled = (id: string) => screen.getByTestId(id).props.accessibilityState?.disabled === true;

beforeEach(() => {
  (jest.requireMock('react-native-mmkv') as { __resetMMKV(): void }).__resetMMKV();
});

describe('EditLineSheet', () => {
  it('saving new words keeps matched timings, then "Re-sync now?" opens Tap To Sync on the line', () => {
    const { segs, onResyncRequested, onClose } = renderSheet({ kind: 'edit', segment: 0 });
    expect(screen.getByTestId('review-line-input').props.value).toBe('Hello darkness my old friend');
    type('Hello darkness my old dear friend');
    save();
    const ws = segs()[0]!.words;
    expect(ws.map((w) => w.text)).toEqual(['Hello', 'darkness', 'my', 'old', 'dear', 'friend']);
    expect(ws[0]).toMatchObject({ id: 'w0', start_time: 10, end_time: 10.5 });
    expect(ws[5]).toMatchObject({ id: 'w4', start_time: 12.3, end_time: 13 });
    expect(ws[4]).toMatchObject({ start_time: 12.2, end_time: 12.3, timing_estimated: true });

    expect(screen.getByText('Timing guessed for 1 new word')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('review-line-resync-now'));
    expect(onResyncRequested).toHaveBeenCalledWith(0);
  });

  it('a save without new words (a fixed typo) just closes', () => {
    const { segs, onClose } = renderSheet({ kind: 'edit', segment: 0 });
    type('hello darkness my old friend');
    save();
    expect(segs()[0]!.text).toBe('hello darkness my old friend');
    expect(segs()[0]!.words[0]).toMatchObject({ id: 'w0', start_time: 10 });
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('review-line-resync-now')).toBeNull();
  });

  it('unchanged text is not an edit', () => {
    const { store, onClose } = renderSheet({ kind: 'edit', segment: 0 });
    save();
    expect(store.getState().editCount).toBe(0);
    expect(onClose).toHaveBeenCalled();
  });

  it('Save is disabled while the text is empty (no wordless lines)', () => {
    const { store } = renderSheet({ kind: 'edit', segment: 0 });
    type('   ');
    expect(disabled('review-line-save')).toBe(true);
    save();
    expect(store.getState().editCount).toBe(0);
  });

  it('a new line after a line spans to the next line with estimated timing', () => {
    const { segs, onResyncRequested } = renderSheet({ kind: 'insertAfter', segment: 0 });
    expect(screen.getByText('New line')).toBeTruthy();
    expect(disabled('review-line-save')).toBe(true);
    type('la la');
    save();
    expect(segs()).toHaveLength(5);
    const n = segs()[1]!;
    expect(n.text).toBe('la la');
    // Line 0 ends at 13, line 1 starts at 14.
    expect(n.words.map((w) => [w.start_time, w.end_time, w.timing_estimated])).toEqual([
      [13, 13.5, true],
      [13.5, 14, true],
    ]);
    expect(screen.getByText('Timing guessed for 2 new words')).toBeTruthy();
    fireEvent.press(screen.getByTestId('review-line-resync-now'));
    expect(onResyncRequested).toHaveBeenCalledWith(1);
  });

  it('typing the words for a vocal gap inserts them inside the gap', () => {
    const { segs, onClose } = renderSheet({ kind: 'gap', gap: GAP });
    type('softly creeping');
    save();
    const at = segs().findIndex((s) => s.text === 'softly creeping');
    expect(at).toBe(3);
    const n = segs()[at]!;
    expect(n.start_time!).toBeGreaterThanOrEqual(21.8);
    expect(n.end_time!).toBeLessThanOrEqual(30);
    expect(n.words.every((w) => w.timing_estimated)).toBe(true);
    fireEvent.press(screen.getByTestId('review-line-done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('a line typed after the last one never runs past the end of the audio', () => {
    const { segs } = renderSheet({ kind: 'insertAfter', segment: 3 }, correctionsFixture(), 32.5);
    type('la la');
    save();
    expect(segs()[4]).toMatchObject({ text: 'la la', start_time: 31.5, end_time: 32.5 });
  });

  it('several lines typed for a gap re-sync with "keep going" on; one line without', () => {
    const many = renderSheet({ kind: 'gap', gap: GAP });
    type('softly creeping\nleft its seeds');
    save();
    fireEvent.press(screen.getByTestId('review-line-resync-now'));
    expect(many.onResyncRequested).toHaveBeenCalledWith(3, { keepGoing: true });
    many.unmount();

    const one = renderSheet({ kind: 'gap', gap: GAP });
    type('softly creeping');
    save();
    fireEvent.press(screen.getByTestId('review-line-resync-now'));
    expect(one.onResyncRequested).toHaveBeenCalledWith(3);
  });

  it('closes when the line being edited is gone', () => {
    const { onClose } = renderSheet({ kind: 'edit', segment: 9 });
    expect(onClose).toHaveBeenCalled();
  });
});
