// The Me go-tos shelf (4b D4): recs go_tos merged with the phone's go-tos, and Discover's "Not for me" reaching it.
import * as decide from '@nomad/api-decide';
import type { MeSong } from '@nomad/core';
import { IntlProvider } from '@nomad/i18n';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';

import { userKeyFor } from '../../auth/userKey';
import { useSongFeedback } from '../../discover/useSongFeedback';
import { goTosStorageKey } from '../../me/account';
import { libraryKeyFor } from '../../me/useLibrary';
import { getMadeKeyFor } from '../../me/useGetMade';
import { goToRows, GoTosShelf } from '../../me/GoTosShelf';
import { appStorage } from '../../storage';
import { useVoiceStore } from '../../voice/voiceStore';
import { resetMe, signIn, wrapperFor } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getRecommendationsV2: jest.fn(),
  hideSong: jest.fn(),
  unhideSong: jest.fn(async () => {}),
  configureClient: jest.fn(),
}));
const api = decide as jest.Mocked<typeof decide>;

const EMAIL = 'me@example.com';
const song = (title: string, o: Partial<MeSong> = {}): MeSong => ({
  key: `k_${title}`, song_key: `k_${title}`, artist: 'Band', title, times_sung: 2, backfill_times: 0,
  feel_counts: { great: 0, ok: 0, bad: 0 }, latest_feel: null, crowd_pleaser_count: 0, vibes: [], loved: false,
  hidden: false, setlist_ids: [], facets: null, ...o,
});
const rec = (title: string, o: Record<string, unknown> = {}) =>
  ({ song_key: `k_${title}`, artist: 'Band', title, reason: '', reason_type: 'sung_before', reason_artist: null,
    score: 1, has_karaoke_version: true, karaoke: { community: true, karafun: false }, fit: null, ...o }) as never;
const recsWith = (sections: { id: string; songs: unknown[] }[]) =>
  ({ sections: sections.map((s) => ({ title_key: 't', reason_key: null, ...s })), filters_applied: {}, next_cursor: null,
    has_profile: true, catalog_run: 'r' }) as never;
const cachedTitles = () => {
  const raw = appStorage.getString(goTosStorageKey(userKeyFor(EMAIL)));
  return raw ? (JSON.parse(raw) as { songs: { title: string }[] | null }).songs?.map((s) => s.title) : undefined;
};

/** The app's query client plus English messages (the shelf renders copy). */
const shelfWrapper = (client: QueryClient) => {
  const Q = wrapperFor(client);
  return function W({ children }: { children: ReactNode }) {
    return (
      <IntlProvider locale="en">
        <Q>{children}</Q>
      </IntlProvider>
    );
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  useVoiceStore.getState().clear();
});

describe('goToRows', () => {
  const uncat = song('Pub', { key: 'u:band|pub', song_key: null, times_sung: 3 });

  it('a phone library merely behind decide (times_sung 1, no feel) keeps the recs go-to', () => {
    const rows = goToRows([song('Hit', { times_sung: 1 })], [rec('Hit')], new Set());
    expect(rows.map((r) => r.title)).toEqual(['Hit']);
  });

  it('drops a recs go-to that is hidden or latest bad on the phone, or downgraded by a pending write', () => {
    const items = [
      song('Hidden', { hidden: true }),
      song('Bad', { latest_feel: 'bad', times_sung: 5 }),
      song('Downgraded', { latest_feel: 'ok', times_sung: 1 }),
    ];
    const rows = goToRows(items, [rec('Hidden'), rec('Bad'), rec('Downgraded')], new Set(['k_Downgraded']));
    expect(rows).toEqual([]);
  });

  it('appends catalogued go-tos with pending writes and uncatalogued ones, deduped, five at most', () => {
    const items = [song('Fresh', { times_sung: 4 }), song('Synced', { times_sung: 9 }), uncat, song('Hit', { times_sung: 3 })];
    const rows = goToRows(items, [rec('Hit')], new Set(['k_Fresh', 'k_Hit']));
    // Synced (no pending write) is decide's to place: it isn't in the section, so it isn't added.
    expect(rows.map((r) => r.title)).toEqual(['Hit', 'Fresh', 'Pub']);
    const many = [1, 2, 3, 4, 5, 6].map((n) => song(`P${n}`, { times_sung: 10 - n }));
    expect(goToRows(many, [rec('Hit')], new Set(many.map((s) => s.key)))).toHaveLength(5);
  });
});

describe('GoTosShelf', () => {
  const items = [song('Local', { times_sung: 3 })];

  it('an empty go_tos section falls back to the local go-tos', async () => {
    const client = resetMe(EMAIL);
    api.getRecommendationsV2.mockResolvedValue(recsWith([{ id: 'go_tos', songs: [] }]));
    render(<GoTosShelf items={items} pending={new Set()} />, { wrapper: shelfWrapper(client) });
    await waitFor(() => expect(api.getRecommendationsV2).toHaveBeenCalled());
    await waitFor(() => expect(cachedTitles()).toBeUndefined());
    expect(screen.getByTestId('me-goto-0')).toHaveTextContent(/Local/);
  });

  it('a Discover "Not for me" takes the song off the shelf and the offline cache; undo puts it back', async () => {
    const client = resetMe(EMAIL);
    api.getRecommendationsV2.mockResolvedValue(recsWith([{ id: 'go_tos', songs: [rec('Hit'), rec('Other')] }]));
    let finishHide!: () => void;
    api.hideSong.mockImplementation(() => new Promise<void>((r) => (finishHide = r)) as never);
    const w = wrapperFor(client);
    const shelf = render(<GoTosShelf items={items} pending={new Set()} />, { wrapper: shelfWrapper(client) });
    await waitFor(() => expect(shelf.getByTestId('me-goto-0')).toHaveTextContent(/Hit/));
    await waitFor(() => expect(cachedTitles()).toEqual(['Hit', 'Other']));
    const disc = renderHook(() => useSongFeedback(), { wrapper: w });

    act(() => disc.result.current.hide(rec('Hit')));
    await waitFor(() => expect(shelf.getByTestId('me-goto-0')).toHaveTextContent(/Other/));
    expect(shelf.queryByTestId('me-goto-1')).toBeNull();
    expect(cachedTitles()).toEqual(['Other']);

    act(() => disc.result.current.undoHide(rec('Hit')));
    await waitFor(() => expect(shelf.getByTestId('me-goto-0')).toHaveTextContent(/Hit/));
    expect(cachedTitles()).toEqual(['Hit', 'Other']);
    await act(async () => finishHide());
    await waitFor(() => expect(api.unhideSong).toHaveBeenCalledWith('k_Hit'));
  });

  it('a hide while the shelf is not mounted still rewrites the offline cache', async () => {
    const client = resetMe(EMAIL);
    appStorage.set(goTosStorageKey(userKeyFor(EMAIL)), JSON.stringify({ songs: [rec('Hit'), rec('Other')], savedAt: Date.now() }));
    api.hideSong.mockResolvedValue(undefined as never);
    const disc = renderHook(() => useSongFeedback(), { wrapper: wrapperFor(client) });
    act(() => disc.result.current.hide(rec('Hit')));
    expect(cachedTitles()).toEqual(['Other']);
  });

  it("an undo after switching accounts never writes the hidden song into the new account's cache", async () => {
    const client = resetMe(EMAIL);
    const other = 'b@example.com';
    appStorage.set(goTosStorageKey(userKeyFor(EMAIL)), JSON.stringify({ songs: [rec('Hit')], savedAt: Date.now() }));
    appStorage.set(goTosStorageKey(userKeyFor(other)), JSON.stringify({ songs: [rec('Theirs')], savedAt: Date.now() }));
    api.hideSong.mockImplementation(() => new Promise(() => {}) as never);
    const disc = renderHook(() => useSongFeedback(), { wrapper: wrapperFor(client) });
    act(() => disc.result.current.hide(rec('Hit')));
    const hiddenSong = disc.result.current.hidden;
    act(() => signIn(other));
    // The toast resets on an account change; call undo directly with the song, as a late tap would.
    act(() => disc.result.current.undoHide(hiddenSong ?? rec('Hit')));
    const raw = JSON.parse(appStorage.getString(goTosStorageKey(userKeyFor(other))) ?? '{}') as { songs: { title: string }[] };
    expect(raw.songs.map((x) => x.title)).toEqual(['Theirs']);
  });

  it('a voice profile synced within 5 min refetches the fits, and a song hidden earlier stays gone', async () => {
    const client = resetMe(EMAIL);
    const voice = (measuredAt: string) => ({
      lowMidi: 45, highMidi: 69, comfortLow: 48, comfortHigh: 66, voiceType: 'baritone' as const, voiceTypeBetween: null,
      register: null, confidence: 'high' as const, method: 'mic' as const, measuredAt,
    });
    useVoiceStore.getState().adopt(voice('2026-10-01T00:00:00Z'));
    // A fresh cache for this voice (as a fetch a minute ago left it): the shelf starts from it, no fetch.
    appStorage.set(
      goTosStorageKey(userKeyFor(EMAIL)),
      JSON.stringify({ songs: [rec('Hit'), rec('Other')], savedAt: Date.now(), voice: '2026-10-01T00:00:00Z' }),
    );
    api.hideSong.mockImplementation(() => new Promise(() => {}) as never); // never settles: no invalidate from it
    const w = wrapperFor(client);
    const shelf = render(<GoTosShelf items={items} pending={new Set()} />, { wrapper: shelfWrapper(client) });
    await waitFor(() => expect(shelf.getByTestId('me-goto-1')).toHaveTextContent(/Other/));
    expect(api.getRecommendationsV2).not.toHaveBeenCalled();
    const disc = renderHook(() => useSongFeedback(), { wrapper: w });
    act(() => disc.result.current.hide(rec('Hit')));
    await waitFor(() => expect(shelf.getByTestId('me-goto-0')).toHaveTextContent(/Other/));

    api.getRecommendationsV2.mockResolvedValue(
      recsWith([{ id: 'go_tos', songs: [rec('Other', { fit: { bucket: 'fits', transpose: 0, octave: 0 } })] }]),
    );
    act(() => useVoiceStore.getState().save(voice('2026-10-02T00:00:00Z')));
    expect(shelf.getByTestId('me-goto-0')).toHaveTextContent(/Other/);
    act(() => useVoiceStore.getState().markSynced('2026-10-02T00:00:00Z'));
    await waitFor(() => expect(api.getRecommendationsV2).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(shelf.getByTestId('me-goto-fit-0')).toBeTruthy());
    expect(shelf.getByTestId('me-goto-0')).toHaveTextContent(/Other/);
    expect(shelf.queryByText('Hit')).toBeNull();
  });

  it("a hide or unhide decide accepted refreshes Me's library and Get this made", async () => {
    const client = resetMe(EMAIL);
    const userKey = userKeyFor(EMAIL);
    api.hideSong.mockResolvedValue(undefined as never);
    const spy = jest.spyOn(client, 'invalidateQueries');
    const invalidated = () => spy.mock.calls.map(([f]) => JSON.stringify((f as { queryKey?: unknown })?.queryKey));
    const disc = renderHook(() => useSongFeedback(), { wrapper: wrapperFor(client) });
    await act(async () => disc.result.current.hide(rec('Hit')));
    await waitFor(() => expect(invalidated()).toEqual(expect.arrayContaining([
      JSON.stringify(libraryKeyFor(userKey)), JSON.stringify(getMadeKeyFor(userKey)),
    ])));
    spy.mockClear();
    await act(async () => disc.result.current.undoHide(rec('Hit')));
    await waitFor(() => expect(api.unhideSong).toHaveBeenCalledWith('k_Hit'));
    await waitFor(() => expect(invalidated()).toEqual(expect.arrayContaining([
      JSON.stringify(libraryKeyFor(userKey)), JSON.stringify(getMadeKeyFor(userKey)),
    ])));
  });
});
