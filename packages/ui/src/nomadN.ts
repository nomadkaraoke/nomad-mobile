/**
 * The Nomad "N" icon as vector data, measured from the brand strip
 * NomadBranding/Nomad-Karaoke-N-Icon-MultiColour-Line-Huge.xcf (440 px tall, icons every ~533.8 px).
 * Units are that source's pixels: one icon is 445 x 440, scale by `height / NOMAD_N.height`.
 *
 * The icon is a box whose top-left is cut by a diagonal down to a notch (an "N" silhouette), filled,
 * outlined with a round-joined border, with three rows of rounded "lyric-line" dashes inside.
 * apps/mobile/assets/brand/nomad-n-strip.svg is `nomadNStripSvg()` written out (a test keeps them equal).
 */

export type NomadDash = { x: number; y: number; w: number; h: number };

export type NomadColorway = { fill: string; border: string; dash: string };

const STROKE = 20;
const DASH_H = 16;

/** Dash rows (start..end, end exclusive), identical in every icon of the source strip. */
const DASH_ROWS: readonly { y: number; spans: readonly (readonly [number, number])[] }[] = [
  { y: 194.5, spans: [[50, 164], [180, 271], [289, 397]] },
  { y: 266.5, spans: [[77, 254], [278, 370]] },
  { y: 336.5, spans: [[48, 111], [131, 318], [336, 399]] },
];

export const NOMAD_N = {
  width: 445,
  height: 440,
  /** Distance from one icon to the next (icon width + gap). */
  period: 534,
  strokeWidth: STROKE,
  /**
   * Centerline of the border (inset by half the stroke); also the fill shape. Top-left corner →
   * diagonal down to the notch → straight up → across the top → down the right → bottom → close.
   */
  outline: 'M9.5 9.5L229.5 122.5L229.5 9.5L434.5 9.5L434.5 429.5L9.5 429.5Z',
  dashRadius: DASH_H / 2,
  dashes: DASH_ROWS.flatMap(({ y, spans }) =>
    spans.map(([x0, x1]): NomadDash => ({ x: x0, y: y - DASH_H / 2, w: x1 - x0, h: DASH_H })),
  ),
} as const;

/** The strip's three colourways, in order. */
export const NOMAD_COLORWAYS: readonly NomadColorway[] = [
  { fill: '#E87FAF', border: '#FCE066', dash: '#242E75' },
  { fill: '#FCE066', border: '#E87FAF', dash: '#E87FAF' },
  { fill: '#242E75', border: '#E87FAF', dash: '#FCE066' },
];

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** All dashes of one icon as a single path of round-capped bars. */
export function nomadDashesPath(dashes: readonly NomadDash[] = NOMAD_N.dashes): string {
  return dashes
    .map(({ x, y, w, h }) => {
      const r = h / 2;
      return `M${num(x + r)} ${num(y)}h${num(w - h)}a${num(r)} ${num(r)} 0 0 1 0 ${num(h)}h${num(h - w)}a${num(r)} ${num(r)} 0 0 1 0 ${num(-h)}Z`;
    })
    .join('');
}

/** One full pattern period (the three colourways side by side) as a standalone SVG document. */
export function nomadNStripSvg(): string {
  const dashes = nomadDashesPath();
  const icons = NOMAD_COLORWAYS.map(
    (c, i) =>
      `  <g transform="translate(${i * NOMAD_N.period} 0)">\n` +
      `    <path d="${NOMAD_N.outline}" fill="${c.fill}" stroke="${c.border}" stroke-width="${NOMAD_N.strokeWidth}" stroke-linejoin="round"/>\n` +
      `    <path d="${dashes}" fill="${c.dash}"/>\n` +
      `  </g>\n`,
  ).join('');
  const w = NOMAD_COLORWAYS.length * NOMAD_N.period;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${NOMAD_N.height}" viewBox="0 0 ${w} ${NOMAD_N.height}">\n` +
    `  <!-- Nomad "N" loading strip: one period (3 icons, ${NOMAD_N.period} units apart). Generated from packages/ui/src/nomadN.ts -->\n` +
    icons +
    `</svg>\n`
  );
}
