// kjbox v1 fixtures and a provider wrapper for Tonight (Nomad night) tests.
import type { MeResult, NightOpen, NowResult, RotationEntry, RotationResult, Song } from '@nomad/api-kjbox';
import { IntlProvider } from '@nomad/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

let seq = 1;

type SongOver = Partial<Omit<Song, 'request'>> & { request?: Partial<Song['request']> };

/** A Your-songs row: the account's own approved request unless overridden. */
export function song(over: SongOver = {}): Song {
  const id = seq++;
  const { request, ...rest } = over;
  return {
    owner: 'me',
    performed: false,
    previewable: false,
    ...rest,
    request: {
      id,
      singer_name: 'Sam',
      song_artist: 'Muse',
      song_title: `Song ${id}`,
      source_type: 'local',
      status: 'approved',
      created_at: '2026-10-21T20:00:00Z',
      linked_entry_id: 100 + id,
      additional_singers: null,
      supersedes_request_id: null,
      media_consent: null,
      for_friend: false,
      ...request,
    },
  };
}

/** An estimate at a 1-based queue position (`expectedS` defaults to 5 min per place ahead). */
export const at = (position: number, expectedS = (position - 1) * 300, nowSinging = false): NonNullable<Song['estimate']> => ({
  position,
  expected_s: expectedS,
  range_low_s: Math.max(0, expectedS - 180),
  range_high_s: expectedS + 180,
  spread_source: 'tonight',
  close_to_front: position <= 2,
  now_singing: nowSinging,
});

export function me(over: Partial<MeResult> = {}): MeResult {
  return {
    api_version: '1.0',
    me: { name: 'Sam', phone: null, photo_consent: null, instagram: null },
    songs: [],
    next: null,
    sung_tonight: [],
    unlinked_identity_entries: 0,
    ...over,
  };
}

export const nowResult = (over: Partial<NowResult> = {}): NowResult => ({
  api_version: '1.0',
  now_singing: { first_name: 'Ana', display_name: 'Ana', song_artist: 'Valerie - Amy Winehouse' },
  up_next: { first_name: 'Ben', display_name: 'Ben', song_artist: 'Hello - Adele' },
  queued_count: 4,
  ...over,
});

export const entry = (position: number, over: Partial<RotationEntry> = {}): RotationEntry => ({
  position,
  first_name: `Singer${position}`,
  display_name: `Singer${position}`,
  song_artist: `Tune ${position} - Band`,
  status: position === 1 ? 'Now Singing' : 'Waiting',
  entry_id: 500 + position,
  previewable: false,
  now_singing: position === 1,
  expected_s: (position - 1) * 300,
  range_low_s: 0,
  range_high_s: position * 300,
  ...over,
});

export const rotationResult = (entries: RotationEntry[], rev = 7): RotationResult => ({
  api_version: '1.0',
  entries,
  spread_source: 'tonight',
  rev,
});

export const nightOpen = (over: Partial<NightOpen> = {}): NightOpen => ({
  api_version: '1.0',
  open: true,
  night_id: 'aaaaaaaaaaaaaaaa',
  kj_name: 'Andrew',
  footer_message: '',
  notices: [],
  notice_defs: {},
  social: {},
  contact: {},
  features: { make: true, simple_mode: false, ask_photo_consent: false, quick_version: true, tips: true },
  rev: 7,
  needs_name: false,
  ...over,
});

/** Bidi-isolated text as `isolate()` (@nomad/i18n) renders it inside a sentence. */
export const iso = (s: string) => `\u2068${s}\u2069`;
/** A row title as rendered: "<title> by <artist>". */
export const by = (title: string, artist = 'Muse') => `${iso(title)} by ${iso(artist)}`;

/** Renders with i18n (en) and a fresh query client (kept across rerender). */
export function renderTonight(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <IntlProvider locale="en">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </IntlProvider>
  );
  return { ...render(ui, { wrapper }), client };
}
