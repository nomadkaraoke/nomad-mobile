import { Canvas, Rect } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { colors } from './tokens';

export type PianoKey = { midi: number; x: number; w: number };
export type PianoKeyLayout = { white: PianoKey[]; black: PianoKey[] };

const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (midi: number) => BLACK.has(((midi % 12) + 12) % 12);
/** Black keys are this fraction of a white key's width and of the strip's height. */
const BLACK_W = 0.6;
const BLACK_H = 0.6;
/** Gap between white keys, px. */
const GAP = 1;
const LIVE_W = 3;
/** The live pitch line's colour (stands out on white, black and lit keys). */
export const PIANO_LIVE_COLOR = colors.purple;

/**
 * White keys share the width equally; each black key is centred on the seam between its white neighbours
 * (kept inside the strip when it is the first or last key).
 */
export function pianoKeyLayout(lowMidi: number, highMidi: number, width: number): PianoKeyLayout {
  const lo = Math.round(lowMidi);
  const hi = Math.round(highMidi);
  if (hi < lo) return { white: [], black: [] };
  const whiteMidis: number[] = [];
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whiteMidis.push(m);
  const ww = whiteMidis.length ? width / whiteMidis.length : 0;
  const white = whiteMidis.map((midi, i) => ({ midi, x: i * ww, w: ww }));
  const bw = ww * BLACK_W;
  const black: PianoKey[] = [];
  let seen = 0; // white keys left of the current one
  for (let m = lo; m <= hi; m++) {
    if (!isBlack(m)) {
      seen++;
      continue;
    }
    const seam = seen * ww;
    black.push({ midi: m, x: Math.min(Math.max(0, seam - bw / 2), Math.max(0, width - bw)), w: bw });
  }
  return { white, black };
}

/** x of a (fractional) MIDI pitch: between key centres, clamped to the first and last key. */
export function pianoX(layout: PianoKeyLayout, midi: number): number {
  const centres = [...layout.white, ...layout.black]
    .map((k) => ({ midi: k.midi, x: k.x + k.w / 2 }))
    .sort((a, b) => a.midi - b.midi);
  if (centres.length === 0) return 0;
  const first = centres[0]!;
  const last = centres[centres.length - 1]!;
  if (midi <= first.midi) return first.x;
  if (midi >= last.midi) return last.x;
  const i = centres.findIndex((c) => c.midi > midi);
  const a = centres[i - 1]!;
  const b = centres[i]!;
  return a.x + ((midi - a.midi) / (b.midi - a.midi)) * (b.x - a.x);
}

export type PianoStripProps = {
  lowMidi: number;
  highMidi: number;
  /** Keys lit in a colour (held notes, the singer's range). */
  marks?: { midi: number; color: string }[];
  /** A translucent span over the keys from..to (inclusive), e.g. the comfortable middle. */
  band?: { from: number; to: number; color: string };
  /** The live pitch (fractional MIDI) as a thin line; null or omitted draws none. */
  live?: number | null;
  height: number;
  testID: string;
  accessibilityLabel?: string;
};

/**
 * A piano keyboard strip, low notes on the left in every locale (music notation, not reading order). Our only
 * Skia entry point for keyboards, like WaveformCanvas for waveforms.
 */
export function PianoStrip({ lowMidi, highMidi, marks, band, live, height, testID, accessibilityLabel }: PianoStripProps) {
  const [width, setWidth] = useState(0);
  const layout = useMemo(() => pianoKeyLayout(lowMidi, highMidi, width), [lowMidi, highMidi, width]);
  const lit = useMemo(() => new Map((marks ?? []).map((m) => [Math.round(m.midi), m.color])), [marks]);
  const keyOf = (midi: number) =>
    layout.white.find((k) => k.midi === midi) ?? layout.black.find((k) => k.midi === midi) ?? null;

  const bandFrom = band ? keyOf(Math.max(Math.round(band.from), Math.round(lowMidi))) : null;
  const bandTo = band ? keyOf(Math.min(Math.round(band.to), Math.round(highMidi))) : null;
  const liveX = live !== null && live !== undefined && width > 0 ? pianoX(layout, live) : null;

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel}
      // Low notes stay on the left under RTL too.
      style={{ height, direction: 'ltr' }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Canvas style={{ flex: 1 }}>
        {layout.white.map((k) => (
          <Rect key={`w${k.midi}`} x={k.x} y={0} width={Math.max(0, k.w - GAP)} height={height} color={lit.get(k.midi) ?? colors.text} />
        ))}
        {band && bandFrom && bandTo ? (
          <Rect
            x={bandFrom.x}
            y={0}
            width={Math.max(0, bandTo.x + bandTo.w - bandFrom.x)}
            height={height}
            color={band.color}
            opacity={0.45}
          />
        ) : null}
        {layout.black.map((k) => (
          <Rect key={`b${k.midi}`} x={k.x} y={0} width={k.w} height={height * BLACK_H} color={lit.get(k.midi) ?? colors.bg} />
        ))}
        {liveX !== null ? (
          <Rect x={liveX - LIVE_W / 2} y={0} width={LIVE_W} height={height} color={PIANO_LIVE_COLOR} />
        ) : null}
      </Canvas>
    </View>
  );
}
