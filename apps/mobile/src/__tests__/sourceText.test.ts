import en from '../../../../packages/i18n/messages/en.json';
import { categoryKey, pickReason, sourceRowText } from '../make/sourceText';
import { bestChoice, spotify, youtube } from '../test-utils/makeFixtures';

// A tiny English translator over en.json's `make` namespace (ICU-free keys plus {views}).
const t = (key: string, values?: Record<string, string | number>) => {
  const raw = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], en.make) as string;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(values?.[k] ?? ''));
};

it('describes a torrent in plain words: kind, release, year, quality, availability; no tracker name', () => {
  expect(pickReason(bestChoice(), t)).toBe('Studio album · Black Holes and Revelations · 2006 · lossless · reliable download');
});

it.each([
  [{ release_type: 'Single', seeders: 20 }, 'Single · Black Holes and Revelations · 2006 · lossless · may be slower to fetch'],
  [{ release_type: 'Live album', seeders: 60 }, 'Live recording · Black Holes and Revelations · 2006 · lossless · reliable download'],
  [{ release_type: 'Compilation', seeders: 3 }, 'Compilation · Black Holes and Revelations · 2006 · lossless · may take longer to fetch'],
  [{ seeders: 5, quality_data: { bit_depth: 24 } }, 'Hi-res album · Black Holes and Revelations · 2006 · 24-bit lossless · may take longer to fetch'],
  [{ seeders: 80, quality_data: { media: 'Vinyl' } }, 'Vinyl rip · Black Holes and Revelations · 2006 · lossless · reliable download'],
  [{ is_lossless: false, seeders: 80, release_type: 'Remix' }, 'Other release · Black Holes and Revelations · 2006 · compressed audio · reliable download'],
])('kind and quality for %j', (over, expected) => {
  expect(pickReason({ ...bestChoice(), ...over } as never, t)).toBe(expected);
});

it('YouTube and Spotify: the title is the track, so it stays out of the reason', () => {
  expect(pickReason({ ...youtube(1), formatted_duration: '4:00' }, t)).toBe('YouTube · 2.0M views · 4:00');
  expect(pickReason(spotify(2), t)).toBe('Spotify');
});

it('source rows lead with the title, then who and how good', () => {
  expect(sourceRowText(youtube(1), t)).toEqual({ title: 'Muse - Starlight (Official Video)', detail: 'Muse · 2.0M views' });
});

it('maps every gen category to a heading key, unknown ones to "other"', () => {
  expect(categoryKey('STUDIO ALBUMS')).toBe('studio');
  expect(categoryKey('SOMETHING NEW')).toBe('other');
});
