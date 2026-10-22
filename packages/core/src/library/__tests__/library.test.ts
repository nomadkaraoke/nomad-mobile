import { KARAFUN_LIBRARY_CODE, LIBRARY_FILTERS, matchesLibrary, songLibraries, type LibraryTagged } from '../index';

const songs: Record<string, LibraryTagged> = {
  kvLibraryOnly: { libraries: ['KV'] },
  kvVersionOnly: { versions: [{ kind: 'commercial', brand_code: 'KV' }] },
  communityVersion: { versions: [{ kind: 'community', brand_code: 'NOMAD' }] },
  commercialOther: { libraries: ['SC'], versions: [{ kind: 'commercial', brand_code: 'SC' }] },
  empty: {},
};

describe('matchesLibrary truth table', () => {
  const expected: Record<string, [boolean, boolean]> = {
    // [community, karafun]
    kvLibraryOnly: [false, true],
    kvVersionOnly: [false, true],
    communityVersion: [true, false],
    commercialOther: [false, false],
    empty: [false, false],
  };
  for (const [name, [community, karafun]] of Object.entries(expected)) {
    it(`${name}`, () => {
      expect(matchesLibrary(songs[name]!, 'any')).toBe(true);
      expect(matchesLibrary(songs[name]!, 'community')).toBe(community);
      expect(matchesLibrary(songs[name]!, 'karafun')).toBe(karafun);
    });
  }
});

describe('songLibraries', () => {
  it('returns both tags for a song with a KV version and a community version', () => {
    const s: LibraryTagged = {
      versions: [
        { kind: 'commercial', brand_code: 'KV' },
        { kind: 'community', brand_code: 'CC' },
      ],
    };
    expect(songLibraries(s)).toEqual(new Set(['community', 'karafun']));
  });
  it('is empty for an untagged song', () => {
    expect(songLibraries({}).size).toBe(0);
  });
});

describe('constants', () => {
  it('exposes the filters and the KaraFun code', () => {
    expect(LIBRARY_FILTERS).toEqual(['any', 'community', 'karafun']);
    expect(KARAFUN_LIBRARY_CODE).toBe('KV');
  });
});
