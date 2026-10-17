import { readFileSync } from 'fs';
import { join } from 'path';

import { colors } from '../tokens';

// WCAG 2.x relative luminance and contrast ratio.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

it('primary button text meets WCAG AA (4.5:1) on the pink primary', () => {
  expect(contrast(colors.primaryFg, colors.primary)).toBeGreaterThanOrEqual(4.5);
});

it('body and muted text meet AA on the background and on cards', () => {
  for (const surface of [colors.bg, colors.card]) {
    expect(contrast(colors.text, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, surface)).toBeGreaterThanOrEqual(4.5);
  }
});

it('matches the Uniwind @theme in apps/mobile/global.css colour for colour', () => {
  const css = readFileSync(join(__dirname, '../../../../apps/mobile/global.css'), 'utf8');
  const theme = css.slice(css.indexOf('@theme'));
  const fromCss: Record<string, string> = {};
  for (const [, name, value] of theme.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    fromCss[name!.replace(/-([a-z])/g, (_m: string, c: string) => c.toUpperCase())] = value!.toLowerCase();
  }
  const fromTokens = Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, v.toLowerCase()]));
  expect(fromCss).toEqual(fromTokens);
});
