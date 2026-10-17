export const formatCredits = (n: number, locale: string): string => new Intl.NumberFormat(locale).format(n);

export const formatPrice = (cents: number, currency: string, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A track length: "14:32", or "1:02:05" from an hour. Fractions round down; negatives are 0. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
