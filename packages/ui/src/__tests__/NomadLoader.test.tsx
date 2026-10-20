import { readFileSync } from 'fs';
import { join } from 'path';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { cancelAnimation, withRepeat, withTiming } from 'react-native-reanimated';

import { NomadLoader, NOMAD_PATTERN_UNITS, nomadLoaderIconCount } from '../NomadLoader';
import { NOMAD_COLORWAYS, NOMAD_N, nomadDashesPath, nomadNStripSvg } from '../nomadN';

let reduceMotion = false;
let onReduceMotion: ((v: boolean) => void) | undefined;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  reduceMotion = false;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(async () => reduceMotion);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_: string, cb: (v: boolean) => void) => {
    onReduceMotion = cb;
    return { remove };
  }) as unknown as typeof AccessibilityInfo.addEventListener);
});

/** Render, then let the reduce-motion read settle. */
async function renderLoader(ui: React.ReactElement) {
  const r = render(ui);
  await act(async () => {});
  return r;
}

function layout(testID: string, width: number) {
  fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { width, height: 40 } } });
}

/** Fill paths are the ones without a stroke style; one per icon. */
const fills = () => screen.getAllByTestId('skia-path').filter((p) => p.props.path === NOMAD_N.outline && !p.props.style);

it('covers the width plus one three-icon pattern period', () => {
  const step = NOMAD_N.period * (44 / NOMAD_N.height); // 53.4 px per icon at 44 px tall
  expect(nomadLoaderIconCount(534, 44)).toBe(Math.ceil(534 / step) + 3);
  expect(nomadLoaderIconCount(0, 44)).toBe(3);
  expect(nomadLoaderIconCount(100, 0)).toBe(0);
});

it('renders one icon (fill, border, dashes) per slot for its measured width', async () => {
  await renderLoader(<NomadLoader testID="ldr" accessibilityLabel="Loading" height={44} />);
  layout('ldr', 534);
  expect(fills()).toHaveLength(13);
  expect(screen.getAllByTestId('skia-path')).toHaveLength(13 * 3);
});

it('uses the colourways in strip order: pink, yellow, navy, repeating', async () => {
  await renderLoader(<NomadLoader testID="ldr" accessibilityLabel="Loading" />);
  layout('ldr', 200);
  const colors = fills().map((p) => p.props.color);
  expect(colors.slice(0, 4)).toEqual(['#E87FAF', '#FCE066', '#242E75', '#E87FAF']);
  const borders = screen.getAllByTestId('skia-path').filter((p) => p.props.style === 'stroke');
  expect(borders.slice(0, 3).map((p) => p.props.color)).toEqual(NOMAD_COLORWAYS.map((c) => c.border));
  expect(borders[0]!.props).toMatchObject({ strokeJoin: 'round', strokeWidth: NOMAD_N.strokeWidth });
});

it('places icons one period apart, scaled to the height', async () => {
  await renderLoader(<NomadLoader testID="ldr" accessibilityLabel="Loading" height={44} />);
  layout('ldr', 100);
  const groups = screen.getAllByTestId('skia-group');
  const [move, size] = groups[2]!.props.transform; // groups[0] is the scrolling strip
  expect(move.translateX).toBeCloseTo(53.4);
  expect(size.scale).toBeCloseTo(0.1);
});

it('scrolls one pattern period linearly forever at the given speed', async () => {
  render(<NomadLoader testID="ldr" accessibilityLabel="Loading" height={44} speed={100} />);
  await act(async () => {});
  const distance = NOMAD_PATTERN_UNITS * 0.1; // 160.2 px
  const [to, config] = (withTiming as jest.Mock).mock.calls[0];
  expect(to).toBeCloseTo(distance);
  expect(config.duration).toBeCloseTo(distance * 10);
  expect(withRepeat).toHaveBeenCalledWith(expect.anything(), -1, false);
});

it('stays still with reduced motion, and starts when it is turned off', async () => {
  reduceMotion = true;
  render(<NomadLoader testID="ldr" accessibilityLabel="Loading" />);
  await act(async () => {});
  layout('ldr', 300);
  expect(withRepeat).not.toHaveBeenCalled();
  expect(withTiming).not.toHaveBeenCalled();
  expect(screen.getAllByTestId('skia-path').length).toBeGreaterThan(0);
  act(() => onReduceMotion?.(false));
  expect(withRepeat).toHaveBeenCalledTimes(1);
  act(() => onReduceMotion?.(true));
  expect(cancelAnimation).toHaveBeenCalled();
});

it('does not start before the reduce-motion setting is known', async () => {
  render(<NomadLoader testID="ldr" accessibilityLabel="Loading" />);
  expect(withRepeat).not.toHaveBeenCalled();
  await act(async () => {});
  expect(withRepeat).toHaveBeenCalledTimes(1);
});

it('cancels the animation and the reduce-motion listener on unmount', async () => {
  const { unmount } = render(<NomadLoader testID="ldr" accessibilityLabel="Loading" />);
  await act(async () => {});
  unmount();
  expect(cancelAnimation).toHaveBeenCalled();
  expect(remove).toHaveBeenCalled();
});

it('is an accessible, busy progress bar with the caller’s label', async () => {
  await renderLoader(<NomadLoader testID="ldr" accessibilityLabel="Loading…" />);
  const bar = screen.getByTestId('ldr');
  expect(bar.props).toMatchObject({ accessible: true, accessibilityRole: 'progressbar', accessibilityState: { busy: true } });
  expect(screen.getByLabelText('Loading…')).toBe(bar);
  expect(bar.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ height: 40 })]));
});

it('draws each dash as a round-capped bar', () => {
  expect(nomadDashesPath([{ x: 0, y: 0, w: 40, h: 16 }])).toBe('M8 0h24a8 8 0 0 1 0 16h-24a8 8 0 0 1 0 -16Z');
  expect(NOMAD_N.dashes).toHaveLength(8);
});

it('matches the committed vector source apps/mobile/assets/brand/nomad-n-strip.svg', () => {
  const file = readFileSync(join(__dirname, '../../../../apps/mobile/assets/brand/nomad-n-strip.svg'), 'utf8');
  expect(file).toBe(nomadNStripSvg());
});
