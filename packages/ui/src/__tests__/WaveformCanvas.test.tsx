import { fireEvent, render, screen } from '@testing-library/react-native';

import { buildBars, WaveformCanvas } from '../WaveformCanvas';

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

it('colors bars before the progress cut as played', () => {
  render(<WaveformCanvas testID="wf" peaks={[1, 1, 1, 1]} progress={0.5} height={40} color="#111" playedColor="#f0f" />);
  fireEvent(screen.getByTestId('wf'), 'layout', { nativeEvent: { layout: { width: 100, height: 40 } } });
  const colors = screen.getAllByTestId('skia-rect').map((r) => r.props.color);
  expect(colors).toEqual(['#f0f', '#f0f', '#111', '#111']);
});
