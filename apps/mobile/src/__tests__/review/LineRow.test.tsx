import { IntlProvider } from '@nomad/i18n';
import type { LyricsSegment } from '@nomad/review-core';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { LineRow } from '../../review/lyrics/LineRow';
import { correctionsFixture, rtlFixture } from '../../test-utils/reviewFixtures';

const segs = correctionsFixture().corrected_segments;

function renderRow(segment: LyricsSegment, over: Partial<Parameters<typeof LineRow>[0]> = {}) {
  const props = {
    index: 0,
    segment,
    active: false,
    selected: false,
    isDuet: false,
    isLast: false,
    onPressLine: jest.fn(),
    onWordPress: jest.fn(),
    onSinger: jest.fn(),
    onTool: jest.fn(),
    ...over,
  };
  render(
    <IntlProvider locale="en">
      <LineRow {...props} />
    </IntlProvider>,
  );
  return props;
}

describe('LineRow', () => {
  it('decorates AI-corrected, estimated and untimed words', () => {
    renderRow(segs[0]!, { index: 0 });
    expect(screen.getByTestId('review-word-0-3-ai')).toBeTruthy();
    expect(screen.getByTestId('review-word-0-3').props.accessibilityHint).toMatch(/Changed by AI/);
    expect(screen.queryByTestId('review-word-0-0-ai')).toBeNull();
  });

  it('marks an untimed word and shows no start time for its timing', () => {
    renderRow(segs[1]!, { index: 1 });
    expect(screen.getByTestId('review-word-1-3-untimed')).toBeTruthy();
    expect(screen.getByText('0:14')).toBeTruthy();
  });

  it('marks an estimated word', () => {
    renderRow(segs[2]!, { index: 2 });
    expect(screen.getByTestId('review-word-2-2-est')).toBeTruthy();
  });

  it('tapping the line (or a word of an unselected line) selects it', () => {
    const p = renderRow(segs[0]!, { index: 0 });
    fireEvent.press(screen.getByTestId('review-line-0'));
    fireEvent.press(screen.getByTestId('review-word-0-2'));
    expect(p.onPressLine).toHaveBeenCalledTimes(2);
    expect(p.onWordPress).not.toHaveBeenCalled();
  });

  it('a word of the selected line opens the word', () => {
    const p = renderRow(segs[0]!, { index: 0, selected: true });
    fireEvent.press(screen.getByTestId('review-word-0-2'));
    expect(p.onWordPress).toHaveBeenCalledWith(0, 2);
  });

  it('shows the singer chip only in a duet', () => {
    renderRow(segs[0]!, { index: 0 });
    expect(screen.queryByTestId('review-line-0-singer')).toBeNull();
  });

  it('duet chip shows the singer and reports a press', () => {
    const p = renderRow({ ...segs[0]!, singer: 0 }, { index: 0, isDuet: true });
    expect(screen.getByText('Both')).toBeTruthy();
    fireEvent.press(screen.getByTestId('review-line-0-singer'));
    expect(p.onSinger).toHaveBeenCalledWith(0);
  });

  it('lays an RTL line out right-to-left, whatever the app locale', () => {
    const rtl = rtlFixture().corrected_segments;
    renderRow(rtl[1]!, { index: 1 });
    expect(StyleSheet.flatten(screen.getByTestId('review-line-1-words').props.style).flexDirection).toBe('row-reverse');
    renderRow(rtl[0]!, { index: 0 });
    expect(StyleSheet.flatten(screen.getByTestId('review-line-0-words').props.style).flexDirection).toBe('row');
  });

  it('fills sung words on the active line', () => {
    renderRow(segs[0]!, { index: 0, active: true, time: 11.4 });
    expect(screen.getByTestId('review-word-0-1').props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByTestId('review-word-0-2').props.accessibilityState).toEqual({ selected: true });
  });

  it('the selected line shows its toolbar; tools report the line', () => {
    const p = renderRow(segs[0]!, { index: 0, selected: true });
    for (const tool of ['play', 'edit', 'resync', 'nudge'] as const) {
      fireEvent.press(screen.getByTestId(`review-tool-${tool}`));
      expect(p.onTool).toHaveBeenLastCalledWith(tool, 0);
    }
    expect(screen.queryByTestId('review-tool-split')).toBeNull();
    fireEvent.press(screen.getByTestId('review-tool-more'));
    for (const tool of ['split', 'merge', 'insert', 'delete'] as const) {
      fireEvent.press(screen.getByTestId(`review-tool-${tool}`));
      expect(p.onTool).toHaveBeenLastCalledWith(tool, 0);
    }
  });

  it('merge is unavailable on the last line', () => {
    const p = renderRow(segs[3]!, { index: 3, selected: true, isLast: true });
    fireEvent.press(screen.getByTestId('review-tool-more'));
    fireEvent.press(screen.getByTestId('review-tool-merge'));
    expect(p.onTool).not.toHaveBeenCalled();
  });

  it('an unselected line has no toolbar', () => {
    renderRow(segs[0]!, { index: 0 });
    expect(screen.queryByTestId('review-tool-play')).toBeNull();
  });
});
