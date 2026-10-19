import type { SongGroup, SongRef, Version } from '@nomad/api-decide';

import { NO_CHOICE, searchOutcome } from '../outcome';

const song: SongRef = { artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight', popularity: 1, karaoke: true };
const v = (code: string, rank: number, youtube: string | null): Version => ({
  brand_code: code,
  brand_name: code,
  kind: 'community',
  youtube_url: youtube,
  rank,
});
const g = (title: string, versions: Version[]): SongGroup => ({
  song_key: `muse|${title.toLowerCase()}`,
  artist: 'Muse',
  title,
  version_count: versions.length,
  versions,
});

describe('searchOutcome merged versions', () => {
  it('lists playable (youtube_url) versions first, then by rank, across merged same-song groups', () => {
    const groups = [g('Starlight', [v('A', 1, null), v('B', 3, 'https://y/b')]), g('Starlight (Live)', [v('C', 2, 'https://y/c'), v('D', 0, null)])];
    const o = searchOutcome({ status: 'confident', kind: 'same', best: song, candidates: [song] }, groups, null, 'starlight', NO_CHOICE);
    if (o.kind !== 'song' || !o.group) throw new Error('expected a song outcome with a group');
    expect(o.group.versions.map((x) => x.brand_code)).toEqual(['C', 'B', 'D', 'A']);
    expect(o.group.version_count).toBe(4);
  });
});
