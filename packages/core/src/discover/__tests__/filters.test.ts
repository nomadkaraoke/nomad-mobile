import {
  activeFilterCount,
  DECADES,
  DEFAULT_REC_FILTERS,
  filtersKey,
  GENRE_IDS,
  toRecQuery,
  withoutVoiceFilters,
  type RecFilters,
} from '../index';

const f = (over: Partial<RecFilters>): RecFilters => ({ ...DEFAULT_REC_FILTERS, ...over });

describe('constants', () => {
  it('has the 22 genre ids and 8 decades', () => {
    expect(GENRE_IDS).toHaveLength(22);
    expect(GENRE_IDS).toContain('other');
    expect(new Set(GENRE_IDS).size).toBe(22);
    expect(DECADES).toEqual(['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']);
  });
});

describe('toRecQuery', () => {
  it('omits defaults', () => {
    expect(toRecQuery(DEFAULT_REC_FILTERS, 'any')).toEqual({});
  });

  it.each<[Partial<RecFilters>, Record<string, string | string[]>]>([
    [{ genre: ['rock', 'pop'] }, { genre: ['rock', 'pop'] }],
    [{ mood: ['happy', 'sad'] }, { mood: ['happy', 'sad'] }],
    [{ energy: 'mid' }, { energy: 'mid' }],
    [{ decade: ['1980s'] }, { decade: ['1980s'] }],
    [{ popularity: 60 }, { popularity: '60' }],
    [{ popularity: 0 }, { popularity: '0' }],
    [{ leadGender: 'female' }, { lead_gender: 'female' }],
    [{ duration: 'long' }, { duration: 'long' }],
    [{ classic: true }, { classic: 'true' }],
    [{ explicit: 'exclude' }, { explicit: 'exclude' }],
    [{ hasKaraoke: 'make' }, { has_karaoke: 'make' }],
    [{ sort: 'az' }, { sort: 'az' }],
    [{ singable: true }, { singable: 'true' }],
    [{ sort: 'fit' }, { sort: 'fit' }],
    [{ singable: true, sort: 'fit' }, { singable: 'true', sort: 'fit' }],
  ])('%j -> %j', (over, expected) => {
    expect(toRecQuery(f(over), 'any')).toEqual(expected);
  });

  it('adds library when not any', () => {
    expect(toRecQuery(DEFAULT_REC_FILTERS, 'karafun')).toEqual({ library: 'karafun' });
    expect(toRecQuery(DEFAULT_REC_FILTERS, 'community')).toEqual({ library: 'community' });
  });

  it('does not alias the filter arrays', () => {
    const filters = f({ genre: ['rock'] });
    const q = toRecQuery(filters, 'any');
    (q.genre as string[]).push('x');
    expect(filters.genre).toEqual(['rock']);
  });
});

describe('withoutVoiceFilters', () => {
  it('drops Singable and the fit sort (no voice profile on the phone), keeps the rest', () => {
    expect(withoutVoiceFilters(f({ singable: true, sort: 'fit', genre: ['rock'] }))).toEqual(f({ genre: ['rock'] }));
    const other = f({ sort: 'az' });
    expect(withoutVoiceFilters(other)).toBe(other);
  });
});

describe('activeFilterCount', () => {
  it('is 0 for defaults and ignores sort', () => {
    expect(activeFilterCount(DEFAULT_REC_FILTERS)).toBe(0);
    expect(activeFilterCount(f({ sort: 'newest' }))).toBe(0);
  });
  it('counts each non-default field once', () => {
    expect(activeFilterCount(f({ genre: ['rock', 'pop'], mood: ['happy'], classic: true, popularity: 0 }))).toBe(4);
    expect(
      activeFilterCount(
        f({
          energy: 'low',
          decade: ['1990s'],
          leadGender: 'mixed',
          duration: 'short',
          explicit: 'exclude',
          hasKaraoke: 'yes',
        }),
      ),
    ).toBe(6);
  });
});

describe('filtersKey', () => {
  it('is stable under array order and equal for equal filters', () => {
    expect(filtersKey(f({ genre: ['rock', 'pop'] }), 'any')).toBe(filtersKey(f({ genre: ['pop', 'rock'] }), 'any'));
  });
  it('differs by value and library', () => {
    expect(filtersKey(f({ energy: 'low' }), 'any')).not.toBe(filtersKey(f({ energy: 'high' }), 'any'));
    expect(filtersKey(DEFAULT_REC_FILTERS, 'any')).not.toBe(filtersKey(DEFAULT_REC_FILTERS, 'karafun'));
  });
  it('does not mutate input arrays', () => {
    const filters = f({ genre: ['rock', 'pop'] });
    filtersKey(filters, 'any');
    expect(filters.genre).toEqual(['rock', 'pop']);
  });
});
