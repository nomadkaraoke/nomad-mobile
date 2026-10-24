import type { FitBucket } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';

/** What the badge needs: core's `FitResult` or decide's `RecSong.fit` (its `octave` is a plain number). */
export type BadgeFit = { bucket: FitBucket; transpose: number; octave: number };

type Copy = { key: string; n?: number };

/** The message key (and key count) for a fit; null for `outside`, which shows nothing. */
export function fitCopy(fit: BadgeFit): Copy | null {
  const n = Math.abs(fit.transpose);
  const dir = fit.transpose < 0 ? 'Down' : 'Up';
  switch (fit.bucket) {
    case 'fits':
      return { key: 'fits' };
    case 'stretch':
      return { key: 'stretch' };
    case 'outside':
      return null;
    case 'fitsIn': {
      if (fit.octave === 0) return n === 0 ? { key: 'fits' } : { key: `keys${dir}`, n };
      const oct = fit.octave < 0 ? 'octaveDown' : 'octaveUp';
      return n === 0 ? { key: oct } : { key: `${oct}Keys${dir}`, n };
    }
  }
}

/**
 * How a song fits the singer's voice: "Fits your voice", "Try it 2 keys down", "Fits an octave up", "A stretch".
 * A song outside the range shows nothing (the picks never call a song a bad fit).
 */
export function FitBadge({ fit, testID }: { fit: BadgeFit | null | undefined; testID: string }) {
  const t = useTranslations('fit');
  const copy = fit ? fitCopy(fit) : null;
  if (!fit || !copy) return null;
  const good = fit.bucket !== 'stretch';
  return (
    <Text
      testID={testID}
      className={`overflow-hidden rounded-full px-2 py-0.5 text-xs font-semibold ${
        good ? 'bg-success/15 text-success' : 'bg-gold/15 text-gold'
      }`}
    >
      {copy.n === undefined ? t(copy.key) : t(copy.key, { n: copy.n })}
    </Text>
  );
}
