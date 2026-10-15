import { Canvas, Group, Rect } from '@shopify/react-native-skia';
import { useState } from 'react';
import { View } from 'react-native';

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

export type WaveformCanvasProps = {
  peaks: readonly number[];
  /** Playback position 0..1; bars left of it use playedColor. */
  progress: number;
  height: number;
  testID: string;
  color?: string;
  playedColor?: string;
};

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
}: WaveformCanvasProps) {
  const [width, setWidth] = useState(0);
  const bars = buildBars(peaks, width, height);
  const cut = Math.max(0, Math.min(1, progress)) * width;
  return (
    <View testID={testID} style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Canvas style={{ flex: 1 }}>
        <Group>
          {bars.map((b, i) => (
            <Rect
              key={i}
              x={b.x}
              y={b.y}
              width={Math.max(1, b.w - 1)}
              height={b.h}
              color={b.x < cut ? playedColor : color}
            />
          ))}
        </Group>
      </Canvas>
    </View>
  );
}
