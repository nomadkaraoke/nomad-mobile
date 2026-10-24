import { fireEvent, render, screen } from '@testing-library/react-native';

import { PIANO_BLACK_KEY, PIANO_KEY_OUTLINE, PIANO_LIVE_COLOR, PianoStrip, pianoKeyLayout, pianoShade, pianoX } from '../PianoStrip';
import { colors } from '../tokens';

it('lays A2..E4 (45..64) out as 12 white keys with the black keys between them', () => {
  const { white, black } = pianoKeyLayout(45, 64, 300);
  expect(white.map((k) => k.midi)).toEqual([45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62, 64]);
  expect(white.every((k) => k.w === 25)).toBe(true);
  expect(white.map((k) => k.x)).toEqual(white.map((_, i) => i * 25));
  expect(black.map((k) => k.midi)).toEqual([46, 49, 51, 54, 56, 58, 61, 63]);
  for (const b of black) {
    const left = white.find((k) => k.midi === b.midi - 1)!;
    const right = white.find((k) => k.midi === b.midi + 1)!;
    // Centred on the seam between its two white neighbours, narrower than a white key.
    expect(b.x + b.w / 2).toBeCloseTo(left.x + left.w);
    expect(right.x).toBeCloseTo(left.x + left.w);
    expect(b.w).toBeLessThan(left.w);
  }
});

it('keeps a black edge key inside the strip', () => {
  const { white, black } = pianoKeyLayout(46, 48, 100);
  expect(white.map((k) => k.midi)).toEqual([47, 48]);
  expect(black[0]).toMatchObject({ midi: 46, x: 0 });
});

it('handles an empty or inverted range and zero width', () => {
  expect(pianoKeyLayout(60, 50, 100)).toEqual({ white: [], black: [] });
  expect(pianoKeyLayout(60, 62, 0).white.every((k) => k.w === 0)).toBe(true);
});

it('maps a fractional pitch between key centres and clamps to the strip', () => {
  const layout = pianoKeyLayout(60, 64, 300); // C4 D4 E4, 100 px each
  expect(pianoX(layout, 60)).toBe(50);
  expect(pianoX(layout, 62)).toBe(150);
  expect(pianoX(layout, 61)).toBeCloseTo(100); // C#4 sits on the C/D seam
  expect(pianoX(layout, 61.5)).toBeCloseTo(125);
  expect(pianoX(layout, 40)).toBe(50);
  expect(pianoX(layout, 90)).toBe(250);
});

function layout(width = 300) {
  fireEvent(screen.getByTestId('piano'), 'layout', { nativeEvent: { layout: { width, height: 60 } } });
}

it('colours marked keys, draws the band and the live pitch line', () => {
  render(
    <PianoStrip
      testID="piano"
      lowMidi={60}
      highMidi={64}
      height={60}
      marks={[{ midi: 62, color: '#f0f' }, { midi: 61, color: '#0ff' }]}
      band={{ from: 60, to: 62, color: '#ff0' }}
      live={62}
      accessibilityLabel="Keyboard"
    />,
  );
  layout();
  const rects = screen.getAllByTestId('skia-rect').map((r) => r.props);
  // D4 (white) lit, C#4 (black) lit.
  expect(rects.find((r) => r.color === '#f0f')).toMatchObject({ x: 100 });
  // A lit black key is a darker shade of its mark, so it stays distinct from lit white neighbours.
  expect(rects.find((r) => r.color === '#0ff')).toBeUndefined();
  expect(rects.find((r) => r.color === pianoShade('#0ff'))).toBeTruthy();
  // The band spans C4's left edge to D4's right edge.
  expect(rects.find((r) => r.color === '#ff0')).toMatchObject({ x: 0, width: 200 });
  expect(rects.find((r) => r.color === PIANO_LIVE_COLOR)).toMatchObject({ x: 150 - 1.5 });
});

it('draws no live line when there is no pitch', () => {
  render(<PianoStrip testID="piano" lowMidi={60} highMidi={64} height={60} live={null} accessibilityLabel="Keyboard" />);
  layout();
  expect(screen.getAllByTestId('skia-rect').some((r) => r.props.color === PIANO_LIVE_COLOR)).toBe(false);
});

it('passes the accessibility label through', () => {
  render(<PianoStrip testID="piano" lowMidi={60} highMidi={64} height={60} accessibilityLabel="Keyboard" />);
  expect(screen.getByLabelText('Keyboard')).toBeTruthy();
});

it('pianoShade darkens a colour towards black', () => {
  expect(pianoShade('#ff7acc', 0.5)).toBe('#803d66');
  expect(pianoShade('#ffffff', 0)).toBe('#000000');
});

it('every black key has a dark outline; unlit ones are dark grey, not the page background', () => {
  render(<PianoStrip testID="piano" lowMidi={60} highMidi={64} height={60} marks={[{ midi: 61, color: '#f0f' }]} accessibilityLabel="Keyboard" />);
  layout();
  const rects = screen.getAllByTestId('skia-rect').map((r) => r.props);
  const outlines = rects.filter((r) => r.color === PIANO_KEY_OUTLINE);
  expect(outlines).toHaveLength(2); // C#4 and D#4
  const unlit = rects.filter((r) => r.color === PIANO_BLACK_KEY);
  expect(unlit).toHaveLength(1); // D#4
  expect(PIANO_BLACK_KEY).not.toBe(colors.bg);
  // The outline is wider than the key it frames.
  const dSharp = unlit[0]!;
  const frame = outlines.find((o) => o.x < dSharp.x && o.x + o.width > dSharp.x + dSharp.width);
  expect(frame).toBeTruthy();
});

it('an unmarked black key inside the band takes the band colour (black keys draw over the band)', () => {
  render(
    <PianoStrip testID="piano" lowMidi={60} highMidi={64} height={60} band={{ from: 61, to: 61, color: '#ff0' }} accessibilityLabel="Keyboard" />,
  );
  layout();
  const rects = screen.getAllByTestId('skia-rect').map((r) => r.props);
  expect(rects.filter((r) => r.color === pianoShade('#ff0'))).toHaveLength(1); // C#4
  expect(rects.filter((r) => r.color === PIANO_BLACK_KEY)).toHaveLength(1); // D#4, outside the band
});
