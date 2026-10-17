// Audio-search fixtures and a route table for make-flow tests.
import type { AudioResult } from '@nomad/api-gen';
import { View } from 'react-native';

import { appRoutes } from './routes';

/** App routes plus a `/credits` stand-in (the credits screen is Task 5). */
export function makeRoutes() {
  return { ...appRoutes(), credits: () => <View testID="credits-stub" /> };
}

const base = { artist: 'Muse', title: 'Black Holes and Revelations' };

// The zod output type lists every optional field; fixtures only set the ones the ranking reads.
const result = (r: Partial<AudioResult> & Pick<AudioResult, 'index' | 'title' | 'artist' | 'provider'>) =>
  r as AudioResult;

/** Lossless, well seeded, filename matches "Starlight": gen's tier 1 "Perfect match". */
export const bestChoice = (index = 0): AudioResult =>
  result({
    ...base,
    index,
    provider: 'RED',
    is_lossless: true,
    seeders: 120,
    release_type: 'Album',
    year: 2006,
    target_file: '03 - Starlight.flac',
    quality_data: {
      format: 'FLAC',
      bit_depth: 16,
      media: 'CD',
    } as AudioResult['quality_data'],
  });

export const youtube = (index: number, title = 'Muse - Starlight (Official Video)'): AudioResult =>
  result({
    index,
    title,
    artist: 'Muse',
    provider: 'YouTube',
    channel: 'Muse',
    is_lossless: false,
    view_count: 2_000_000,
  });

export const spotify = (index: number): AudioResult =>
  result({
    index,
    title: 'Starlight',
    artist: 'Muse',
    provider: 'Spotify',
    is_lossless: false,
    target_file: 'Supermassive',
  });
