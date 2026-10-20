import { Canvas, Group, Path } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { NOMAD_COLORWAYS, NOMAD_N, nomadDashesPath } from './nomadN';

export type NomadLoaderProps = {
  /** Icon height in px (the bar's height). */
  height?: number;
  testID: string;
  /** Translated by the caller (e.g. "Loading…"). */
  accessibilityLabel: string;
  /** Scroll speed in px per second; defaults to 1.5 × height. */
  speed?: number;
  style?: StyleProp<ViewStyle>;
};

const DASHES = nomadDashesPath();

/** One pattern period: the three colourways side by side, in reference units. */
export const NOMAD_PATTERN_UNITS = NOMAD_COLORWAYS.length * NOMAD_N.period;

/**
 * The OS "reduce motion" setting, live (reanimated's useReducedMotion only reads it once);
 * null until the first read answers, so a reduced-motion user never sees the strip start.
 */
function useReduceMotion(): boolean | null {
  const [reduce, setReduce] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (live) setReduce(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/**
 * How many icons cover `width` px plus one pattern period (so the strip can slide a whole
 * period left and wrap without a gap or a colour jump).
 */
export function nomadLoaderIconCount(width: number, height: number): number {
  const step = NOMAD_N.period * (height / NOMAD_N.height);
  if (!(step > 0)) return 0;
  return Math.ceil(Math.max(0, width) / step) + NOMAD_COLORWAYS.length;
}

/**
 * The Nomad "N" icons (pink, yellow, navy) scrolling right to left forever: a brand loading bar.
 * The strip slides one pattern period on the UI thread, then wraps. With reduced motion it stays
 * still. Skia stays inside @nomad/ui (see WaveformCanvas).
 */
export function NomadLoader({ height = 40, testID, accessibilityLabel, speed, style }: NomadLoaderProps) {
  const [width, setWidth] = useState(0);
  const reduceMotion = useReduceMotion();
  const scale = height / NOMAD_N.height;
  const distance = NOMAD_PATTERN_UNITS * scale;
  const pxPerSecond = speed ?? height * 1.5;

  const offset = useSharedValue(0);
  useEffect(() => {
    offset.value = 0;
    if (reduceMotion !== false || !(distance > 0) || !(pxPerSecond > 0)) return;
    offset.value = withRepeat(
      withTiming(distance, { duration: (distance / pxPerSecond) * 1000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(offset);
  }, [offset, reduceMotion, distance, pxPerSecond]);

  const transform = useDerivedValue(() => [{ translateX: -offset.value }]);
  const count = nomadLoaderIconCount(width, height);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
      style={[{ height, alignSelf: 'stretch', overflow: 'hidden' }, style]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Canvas style={{ flex: 1 }}>
        <Group transform={transform}>
          {Array.from({ length: count }, (_, i) => {
            const c = NOMAD_COLORWAYS[i % NOMAD_COLORWAYS.length]!;
            return (
              <Group key={i} transform={[{ translateX: i * NOMAD_N.period * scale }, { scale }]}>
                <Path path={NOMAD_N.outline} color={c.fill} />
                <Path
                  path={NOMAD_N.outline}
                  color={c.border}
                  style="stroke"
                  strokeWidth={NOMAD_N.strokeWidth}
                  strokeJoin="round"
                />
                <Path path={DASHES} color={c.dash} />
              </Group>
            );
          })}
        </Group>
      </Canvas>
    </View>
  );
}
