// Shared setup for the request-flow screen tests (not a test file: no `.test.` in the name).
import type { IdentifyResult, SearchResult, SearchSong, SearchVersion } from '@nomad/api-kjbox';
import { View } from 'react-native';

import * as confirm from '../../../app/tonight/confirm';
import * as search from '../../../app/tonight/search';
import { makeRoutes } from '../../../test-utils/makeFixtures';

export const kn = (i: number, over: Record<string, unknown> = {}): SearchVersion => ({
  source: 'kn',
  priority_class: 'commercial',
  priority_display: `Brand ${i}`,
  kn: { brand_code: `B${i}`, youtube_url: `https://youtu.be/${i}`, ...over },
});
export const local = (path = '/lib/starlight.mp4'): SearchVersion => ({
  source: 'local',
  local: { path, artist: 'Muse', title: 'Starlight', format: 'mp4' },
});
export const group = (title: string, artist = 'Muse', versions: SearchVersion[] = [kn(1), kn(2)]): SearchSong => ({
  key: `${artist}|${title}`,
  artist,
  title,
  version_count: versions.length,
  versions,
});
export const results = (songs: SearchSong[], over: Partial<SearchResult> = {}): SearchResult => ({
  api_version: '1.0',
  songs,
  make_requests_enabled: true,
  simple_mode: false,
  ...over,
});
export const noIdent: IdentifyResult = { api_version: '1.0', status: 'none' };
export const confident = (title: string, artist: string, karaoke = false, kind: IdentifyResult['kind'] = 'same'): IdentifyResult => ({
  api_version: '1.0',
  status: 'confident',
  song: { artist, title, karaoke },
  kind,
  candidates: [],
});

export function requestRoutes() {
  return {
    ...makeRoutes(),
    'tonight/search': search,
    'tonight/confirm': confirm,
    'tonight/make': () => <View testID="tonight-make-stub" />,
  };
}

export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
