import { fireEvent, render, screen } from '@testing-library/react-native';

import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { buildBars, buildBarsPath, WaveformCanvas } from '../WaveformCanvas';

it('buildBars maps peaks to vertically centered bars and clamps to 0..1', () => {
  expect(buildBars([0, 0.5, 2, -1], 100, 40)).toEqual([
    { x: 0, y: 20, w: 25, h: 0 },
    { x: 25, y: 10, w: 25, h: 20 },
    { x: 50, y: 0, w: 25, h: 40 },
    { x: 75, y: 20, w: 25, h: 0 },
  ]);
});

it('buildBars handles empty peaks and zero width', () => {
  expect(buildBars([], 100, 40)).toEqual([]);
  expect(buildBars([1], 0, 40)).toEqual([{ x: 0, y: 0, w: 0, h: 40 }]);
});

function layout(testID: string, width = 100) {
  fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { width, height: 40 } } });
}

it('buildBarsPath draws one rectangle per peak', () => {
  expect(buildBarsPath([0.5, 1], 10, 10)).toBe('M0 2.5h5v5h-5ZM5 0h5v10h-5Z');
  expect(buildBarsPath([], 10, 10)).toBe('');
});

it('draws the bars once in the base color and once, clipped to the progress cut, as played', () => {
  render(<WaveformCanvas testID="wf" peaks={[1, 1, 1, 1]} progress={0.5} height={40} color="#111" playedColor="#f0f" />);
  layout('wf');
  expect(screen.getAllByTestId('skia-path').map((r) => r.props.color)).toEqual(['#111', '#f0f']);
});

it('draws a translucent rect per marker', () => {
  render(
    <WaveformCanvas testID="wf" peaks={[1, 1]} progress={0} height={40} markers={[{ from: 0.25, to: 0.5, color: '#0f0' }]} />,
  );
  layout('wf');
  const rect = screen.getAllByTestId('skia-rect')[0]!;
  expect(rect.props).toMatchObject({ x: 25, width: 25, color: '#0f0' });
});

it('labels the waveform for accessibility', () => {
  render(<WaveformCanvas testID="wf" peaks={[1]} progress={0} height={40} accessibilityLabel="Waveform" />);
  expect(screen.getByLabelText('Waveform')).toBeTruthy();
});

it('reports a tap as a 0..1 fraction of the width', () => {
  const onSeek = jest.fn();
  render(<WaveformCanvas testID="wf" peaks={[1]} progress={0} height={40} onSeek={onSeek} />);
  layout('wf', 200);
  fireGestureHandler(getByGestureTestId('wf-tap'), [{ x: 50 }]);
  expect(onSeek).toHaveBeenCalledWith(0.25);
});

it('reports a pan as clamped fractions', () => {
  const onSeek = jest.fn();
  render(<WaveformCanvas testID="wf" peaks={[1]} progress={0} height={40} onSeek={onSeek} />);
  layout('wf', 200);
  fireGestureHandler(getByGestureTestId('wf-pan'), [{ x: 100 }, { x: 400 }, { x: -20 }]);
  expect(onSeek.mock.calls.map((c) => c[0])).toEqual([1, 0]);
});
