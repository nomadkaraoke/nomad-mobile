import en from '../../../../../packages/i18n/messages/en.json';
import { getSearchConfidence } from '@nomad/core';

import { bestChoice, spotify, youtube } from '../../test-utils/makeFixtures';
import {
  availability,
  categoryKey,
  pickReason,
  pickWarnings,
  sortByTitleMatch,
  sourceRowText,
  titleBadge,
} from '../sourceText';

// Names inside a reason or detail line are bidi-isolated (FSI … PDI), so RTL sentences don't reorder them.
const iso = (name: string) => `\u2068${name}\u2069`;

// A tiny English translator over en.json's `make` namespace (ICU-free keys plus {views}).
const t = (key: string, values?: Record<string, string | number>) => {
  const raw = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], en.make) as string;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(values?.[k] ?? ''));
};

it('describes a torrent in plain words: kind, release, year, quality, availability; no tracker name', () => {
  expect(pickReason(bestChoice(), t)).toBe(`Studio album · ${iso('Black Holes and Revelations')} · 2006 · lossless · reliable download`);
});

it.each([
  [{ release_type: 'Single', seeders: 20 }, `Single · ${iso('Black Holes and Revelations')} · 2006 · lossless · may be slower to fetch`],
  [{ release_type: 'Live album', seeders: 60 }, `Live recording · ${iso('Black Holes and Revelations')} · 2006 · lossless · reliable download`],
  [{ release_type: 'Compilation', seeders: 3 }, `Compilation · ${iso('Black Holes and Revelations')} · 2006 · lossless · may take longer to fetch`],
  [{ seeders: 5, quality_data: { bit_depth: 24 } }, `Hi-res album · ${iso('Black Holes and Revelations')} · 2006 · 24-bit lossless · may take longer to fetch`],
  [{ seeders: 80, quality_data: { media: 'Vinyl' } }, `Vinyl rip · ${iso('Black Holes and Revelations')} · 2006 · lossless · reliable download`],
  [{ is_lossless: false, seeders: 80, release_type: 'Remix' }, `Other release · ${iso('Black Holes and Revelations')} · 2006 · compressed audio · reliable download`],
])('kind and quality for %j', (over, expected) => {
  expect(pickReason({ ...bestChoice(), ...over } as never, t)).toBe(expected);
});

it('YouTube: the title is the video, so it stays out of the reason; Spotify: the title is the album', () => {
  expect(pickReason({ ...youtube(1), formatted_duration: '4:00' }, t)).toBe('YouTube · 2.0M views · 4:00');
  expect(pickReason(spotify(2), t)).toBe(`Spotify · ${iso('Black Holes and Revelations')} · 720.0K views`);
});

it('a Spotify row shows the track (target_file), not the album (spec A108)', () => {
  expect(sourceRowText(spotify(2), t)).toEqual({
    title: 'Supermassive Black Hole',
    detail: `${iso('Muse')} · ${iso('Black Holes and Revelations')} · 720.0K views`,
  });
  // No track name: fall back to the title rather than an empty row.
  expect(sourceRowText({ ...spotify(2), target_file: undefined } as never, t).title).toBe('Black Holes and Revelations');
});

it.each([
  [null, null],
  [undefined, null],
  [0, 'low'],
  [9, 'low'],
  [10, 'medium'],
  [49, 'medium'],
  [50, 'high'],
  [500, 'high'],
])('availability(%p) = %p (gen: High ≥ 50, Medium ≥ 10)', (seeders, expected) => {
  expect(availability(seeders)).toBe(expected);
});

describe('title badges and order', () => {
  const right = { ...bestChoice(0), target_file: 'CD1/03 - Starlight.flac' };
  const wrong = { ...bestChoice(1), target_file: '01 - Take a Bow.flac' };
  const right2 = { ...bestChoice(2), target_file: 'Starlight.mp3' };

  it('a mixed category puts matching files first (stable) and shows both badges', () => {
    const { rows, showMatch } = sortByTitleMatch([wrong, right, right2], 'Starlight');
    expect(rows.map((r) => r.index)).toEqual([0, 2, 1]);
    expect(showMatch).toBe(true);
    expect(titleBadge(right, 'Starlight', showMatch)).toBe('match');
    expect(titleBadge(wrong, 'Starlight', showMatch)).toBe('wrong');
  });

  it('all matching: no "Title match" noise, unless tier 3 forces it; "Wrong track?" always shows', () => {
    expect(sortByTitleMatch([right, right2], 'Starlight')).toEqual({ rows: [right, right2], showMatch: false });
    expect(sortByTitleMatch([right, right2], 'Starlight', true).showMatch).toBe(true);
    expect(sortByTitleMatch([wrong], 'Starlight', true).showMatch).toBe(false);
    expect(titleBadge(right, 'Starlight', false)).toBeNull();
    expect(titleBadge(wrong, 'Starlight', false)).toBe('wrong');
  });

  it('nothing to compare (no filename, non-Latin) → no badge', () => {
    expect(titleBadge({ ...right, target_file: '星光.flac' }, 'Starlight', true)).toBeNull();
  });
});

describe('pick warnings', () => {
  it("translates gen's confidence warnings: wrong file, no lossless, low availability", () => {
    const lowWrong = { ...bestChoice(0), is_lossless: false, release_type: 'Album', seeders: 3, quality_data: { media: 'Vinyl' }, target_file: '01 - Take a Bow.flac' };
    const conf = getSearchConfidence([lowWrong as never], 'Starlight', 'Muse');
    expect(conf.warnings).toHaveLength(3);
    expect(pickWarnings(conf, t)).toEqual([
      'The filename suggests a different track: \u2068Take a Bow\u2069',
      'No lossless sources available — only YouTube/lossy or vinyl rips found',
      'Low availability — may take a bit more time to prepare',
    ]);
  });

  it('isolates the Latin file name so it stays in order inside an RTL sentence', () => {
    const conf = getSearchConfidence([{ ...bestChoice(0), target_file: '01 - Take a Bow.flac' }], 'Starlight', 'Muse');
    const [first] = pickWarnings(conf, (_key, values) => `تحذير: ${String(values?.file)}`);
    expect(first).toBe('تحذير: \u2068Take a Bow\u2069');
  });

  it("adds gen's lossy note when the best is YouTube and no warning already mentions lossless", () => {
    const conf = { tier: 3, reason: '', bestResult: null, best: null, bestCategory: 'YOUTUBE', warnings: [] } as const;
    expect(pickWarnings({ ...conf, warnings: [] }, t)).toEqual([
      'This is a YouTube/lossy source. Lossless audio makes better karaoke when available.',
    ]);
    expect(pickWarnings({ ...conf, warnings: ['Filename may not match your song', 'something new'] }, t)).toEqual([
      'The filename may not match your song',
      'something new',
      'This is a YouTube/lossy source. Lossless audio makes better karaoke when available.',
    ]);
  });

  it('a clean tier 1 pick has no warnings', () => {
    expect(pickWarnings(getSearchConfidence([bestChoice(0)], 'Starlight', 'Muse'), t)).toEqual([]);
  });
});

it('source rows lead with the title, then who and how good', () => {
  expect(sourceRowText(youtube(1), t)).toEqual({ title: 'Muse - Starlight (Official Video)', detail: `${iso('Muse')} · 2.0M views` });
});

it('maps every gen category to a heading key, unknown ones to "other"', () => {
  expect(categoryKey('STUDIO ALBUMS')).toBe('studio');
  expect(categoryKey('SOMETHING NEW')).toBe('other');
});
