import {
  ftsMatchQuery,
  identityNormalize,
  indexText,
  normalize,
  NORMALIZER_VERSION,
  SEARCH_INDEX_VERSION,
  songKey,
  songNorm,
  tokens,
} from '../normalize';
// decide's Python output over tricky inputs (scripts/emit-search-golden.py).
import golden from './normalize.golden.json';

type Row = { in: string; normalize: string; identity: string; songNorm: string; fts: string; indexText: string };

// decide A1's three named tests.
describe('decide A1 named tests', () => {
  it('test_song_key_strips_feat_clause', () => {
    expect(songKey('Zedd feat. Hayley Williams', 'Stay the Night')).toBe('zedd|stay the night');
  });

  it('test_index_text_keeps_featured_names_per_field', () => {
    const out = indexText('Zedd feat. Hayley Williams', 'Stay the Night');
    expect(out).toContain('hayley');
    expect(out).not.toBe('zedd');
  });

  it('test_and_ampersand_equal', () => {
    expect(normalize('Simon & Garfunkel')).toBe(normalize('Simon and Garfunkel'));
  });
});

describe('normalize (kjbox/decide behaviour)', () => {
  it.each([
    ['Beyoncé', 'beyonce'],
    ['MØ', 'mo'],
    ['Straßenbande', 'strassenbande'],
    ['Simon & Garfunkel', 'simon and garfunkel'],
    ['Florence + The Machine', 'florence and the machine'],
    ["Don't Stop", 'dont stop'],
    ['Hello, World! (x)', 'hello world x'],
    ['Stay feat. Justin Bieber', 'stay justin bieber'],
    ['Soft Cell', 'soft cell'],
    ['Taylor Swift ft. Drake', 'taylor swift drake'],
    ['Feats Of Strength', 'feats of strength'],
    ['Song Pt 2', 'song part 2'],
    ['A vs B', 'a versus b'],
    ['Twenty One Pilots', '21 pilots'],
    ['Thirty Seconds To Mars', '30 seconds to mars'],
    ['Rocky IV', 'rocky 4'],
    ['I Will Survive', 'i will survive'],
    ['One Hundred Years', '1 hundred years'],
  ])('%j → %j', (input, want) => {
    expect(normalize(input)).toBe(want);
  });

  it('identity strips the whole feat clause', () => {
    expect(identityNormalize('Stay feat. Justin Bieber')).toBe('stay');
    expect(identityNormalize('Stay (Acoustic) feat. Justin Bieber (Live)')).toBe('stay acoustic');
    expect(identityNormalize('Жft Song')).toBe('жft song');
  });

  it('is null-safe and empty-safe', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
    expect(identityNormalize('')).toBe('');
    expect(tokens('')).toEqual([]);
    expect(ftsMatchQuery('!!!')).toBe('');
    expect(songNorm(null)).toBe('');
    expect(indexText(null)).toBe('');
  });

  it('tokens / fts', () => {
    expect(tokens('Simon & Garfunkel')).toEqual(['simon', 'and', 'garfunkel']);
    expect(ftsMatchQuery('Simon & Garfunkel')).toBe('"simon" "and" "garfunkel"*');
  });

  it('index text adds joined pairs', () => {
    expect(indexText('(Over)Thinking')).toBe('over thinking overthinking');
    expect(indexText('Muse')).toBe('muse');
  });

  it('versions match decide', () => {
    expect(NORMALIZER_VERSION).toBe(3);
    expect(SEARCH_INDEX_VERSION).toBe('3.1');
  });
});

describe.each((golden as Row[]).map((r) => [JSON.stringify(r.in), r] as const))('golden %s', (_label, r) => {
  it('matches Python', () => {
    expect({
      normalize: normalize(r.in),
      identity: identityNormalize(r.in),
      songNorm: songNorm(r.in),
      fts: ftsMatchQuery(r.in),
      indexText: indexText(r.in),
    }).toEqual({ normalize: r.normalize, identity: r.identity, songNorm: r.songNorm, fts: r.fts, indexText: r.indexText });
  });
});
