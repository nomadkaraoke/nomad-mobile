import { Canvas, Group, Path, Rect } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { colors } from './tokens';

export type Bar = { x: number; y: number; w: number; h: number };

/** Lay peaks (0..1 amplitudes, clamped) out as equal-width bars centered vertically. */
export function buildBars(peaks: readonly number[], width: number, height: number): Bar[] {
  if (peaks.length === 0) return [];
  const w = width / peaks.length;
  return peaks.map((p, i) => {
    const h = Math.max(0, Math.min(1, p)) * height;
    return { x: i * w, y: (height - h) / 2, w, h };
  });
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** The bars as one SVG path of rectangles (one Skia draw call instead of one node per bar). */
export function buildBarsPath(peaks: readonly number[], width: number, height: number): string {
  return buildBars(peaks, width, height)
    .map((b) => `M${num(b.x)} ${num(b.y)}h${num(b.w)}v${num(b.h)}h${num(-b.w)}Z`)
    .join('');
}

export type WaveformMarker = { from: number; to: number; color: string };

export type WaveformCanvasProps = {
  peaks: readonly number[];
  /** Playback position 0..1; bars left of it use playedColor. */
  progress: number;
  height: number;
  testID: string;
  color?: string;
  playedColor?: string;
  /** Called with a 0..1 fraction of the width on tap and while panning horizontally. */
  onSeek?: (fraction: number) => void;
  /** Highlighted ranges (fractions of the width) drawn behind the bars. */
  markers?: readonly WaveformMarker[];
  accessibilityLabel?: string;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Newest width/onSeek, read from gesture callbacks (which are registered once, not per render). */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Our only Skia entry point for waveforms (peaks come from gen's /waveform-data). Skia's
 * stewardship moves off Shopify after 2026, so a package rename only touches this file.
 */
export function WaveformCanvas({
  peaks,
  progress,
  height,
  testID,
  color = colors.muted,
  playedColor = colors.primary,
  onSeek,
  markers,
  accessibilityLabel,
}: WaveformCanvasProps) {
  const [width, setWidth] = useState(0);
  const path = useMemo(() => buildBarsPath(peaks, width, height), [peaks, width, height]);
  const cut = clamp01(progress) * width;

  const latest = useLatest({ width, onSeek });
  const gesture = useMemo(() => {
    const seek = (x: number) => {
      const { width: w, onSeek: cb } = latest.current;
      if (w > 0) cb?.(clamp01(x / w));
    };
    // runOnJS(true): callbacks run on the JS thread, so no worklet/reanimated plumbing is needed.
    const tap = Gesture.Tap().runOnJS(true).withTestId(`${testID}-tap`).onEnd((e) => seek(e.x));
    const pan = Gesture.Pan()
      .runOnJS(true)
      .withTestId(`${testID}-pan`)
      .activeOffsetX([-8, 8])
      .failOffsetY([-16, 16])
      .onUpdate((e) => seek(e.x));
    return Gesture.Race(pan, tap);
  }, [testID, latest]);

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        style={{ height }}
        onLayout={(e) => {
          setWidth(e.nativeEvent.layout.width);
        }}
      >
        <Canvas style={{ flex: 1 }}>
          {markers?.map((m, i) => (
            <Rect
              key={i}
              x={clamp01(m.from) * width}
              y={0}
              width={Math.max(0, clamp01(m.to) - clamp01(m.from)) * width}
              height={height}
              color={m.color}
              opacity={0.35}
            />
          ))}
          <Path path={path} color={color} />
          <Group clip={{ x: 0, y: 0, width: cut, height }}>
            <Path path={path} color={playedColor} />
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}
