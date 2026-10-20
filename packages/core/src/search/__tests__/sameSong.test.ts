import { credits, sameSong, songTitleKey } from '../sameSong';

// kjbox static-sing/sing.js sameSong: same title (ignoring "(feat …)" / " - Remastered")
// and a credited artist in common.
describe('songTitleKey', () => {
  it.each([
    ['Mr. Brightside', 'mrbrightside'],
    ['Feliz Navidad - Remastered 2006', 'feliznavidad'],
    ['Stay (feat. Justin Bieber)', 'stay'],
    ['Beyoncé', 'beyonce'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('%j → %j', (text, want) => {
    expect(songTitleKey(text)).toBe(want);
  });
});

describe('credits', () => {
  it('splits on separators and feat words', () => {
    expect(credits('Wisin & Yandel')).toEqual(new Set(['wisin', 'yandel']));
    expect(credits('Yandel feat. Wisin')).toEqual(new Set(['yandel', 'wisin']));
    expect(credits('A, B with C and D / E + F ft. G featuring H')).toEqual(
      new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
    );
    expect(credits(null)).toEqual(new Set());
  });
});

describe('sameSong', () => {
  it('same title and a shared credit', () => {
    expect(sameSong({ artist: 'Wisin & Yandel', title: 'Adore' }, { artist: 'Yandel feat. Wisin', title: 'Adore' })).toBe(
      true,
    );
    expect(
      sameSong({ artist: 'José González', title: 'Heartbeats (Live)' }, { artist: 'Jose Gonzalez', title: 'Heartbeats' }),
    ).toBe(true);
  });

  it('different title or no shared credit', () => {
    expect(sameSong({ artist: 'Muse', title: 'Starlight' }, { artist: 'Muse', title: 'Uprising' })).toBe(false);
    expect(sameSong({ artist: 'Kesha', title: 'Die Young' }, { artist: 'Sylvan Esso', title: 'Die Young' })).toBe(false);
    // kjbox's loose check can't match "Killers" vs "The Killers" (kjbox e2e note).
    expect(
      sameSong({ artist: 'Killers', title: 'Mr. Brightside' }, { artist: 'The Killers', title: 'Mr. Brightside' }),
    ).toBe(false);
  });

  it('missing songs are never the same', () => {
    expect(sameSong(null, { artist: 'Muse', title: 'Starlight' })).toBe(false);
    expect(sameSong({ artist: 'Muse', title: 'Starlight' }, undefined)).toBe(false);
  });
});
