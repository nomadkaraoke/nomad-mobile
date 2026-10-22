import type { SearchSong, SearchVersion, SubmitRequest } from '@nomad/api-kjbox';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { create } from 'zustand';

/** new = a request; change = swap one of my songs, keeping its queue slot (A.39); friend = a song for someone else (A.10). */
export type RequestMode = 'new' | 'change' | 'friend';

/** The song a change replaces (shown as "Replacing {title}"). */
export type Replaces = { id: number; title: string };

export type PendingRequest = {
  song: SearchSong;
  /** A concrete version, or 'auto' = kj_pick with every version (the box binds the best, A.20, A.24). */
  version: SearchVersion | 'auto';
  mode: RequestMode;
  replaces?: Replaces;
  friendName?: string;
  /** Idempotency key: minted once when the singer reaches confirm, reused for every retry (Review Focus 3). */
  clientRequestId: string;
  /** What the singer typed (the confirm's "you searched" breadcrumb, A.19). */
  searched?: string;
};

type RequestStore = {
  /** The flow the singer is in before a song is picked. */
  mode: RequestMode;
  replaces?: Replaces;
  friendName?: string;
  /** The picked song waiting on the confirm screen. */
  pending: PendingRequest | null;
  startChange(replaces: Replaces): void;
  startFriend(name: string): void;
  /** Picks a song: mints a fresh client_request_id for this confirm. */
  pick(song: SearchSong, version: SearchVersion | 'auto', searched?: string): PendingRequest;
  /** Forgets the pending pick and any change/friend mode (leaving search and confirm, A.39). */
  clear(): void;
};

/** A UUID v4 (expo-crypto, with a Math.random fallback where the native module is missing). */
export function newRequestId(): string {
  try {
    const id: unknown = randomUUID();
    if (typeof id === 'string' && id) return id;
  } catch {
    // fall through
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

export const useRequestStore = create<RequestStore>((set, get) => ({
  mode: 'new',
  pending: null,
  startChange(replaces) {
    set({ mode: 'change', replaces, friendName: undefined, pending: null });
  },
  startFriend(name) {
    set({ mode: 'friend', friendName: name.trim(), replaces: undefined, pending: null });
  },
  pick(song, version, searched) {
    const { mode, replaces, friendName } = get();
    const pending: PendingRequest = {
      song,
      version,
      mode,
      ...(mode === 'change' && replaces ? { replaces } : {}),
      ...(mode === 'friend' && friendName ? { friendName } : {}),
      clientRequestId: newRequestId(),
      ...(searched ? { searched } : {}),
    };
    set({ pending });
    return pending;
  },
  clear() {
    set({ mode: 'new', replaces: undefined, friendName: undefined, pending: null });
  },
}));

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The song + source part of a submit/change body, as the web builds it (sing.js pickSpecificVersion / pickKjChoice). */
export type SourceFields = Pick<SubmitRequest, 'song_artist' | 'song_title' | 'source_type' | 'source_ref' | 'source_meta'>;

export function sourceFor(song: SearchSong, version: SearchVersion | 'auto'): SourceFields {
  const base = { song_artist: song.artist, song_title: song.title };
  if (version === 'auto') {
    // kj_pick carries every version; the box keeps the best 50 (ruling E5-R2, A.24).
    return {
      ...base,
      source_type: 'kj_pick',
      source_ref: null,
      source_meta: { group_key: song.key, version_count: song.version_count ?? song.versions.length, versions: song.versions },
    };
  }
  if (version.source === 'local') {
    const local = obj(version.local);
    return {
      song_artist: str(local.artist) || song.artist,
      song_title: str(local.title) || song.title,
      source_type: 'local',
      source_ref: str(local.path),
    };
  }
  const kn = obj(version.kn);
  const divebar = obj(kn.divebar);
  if (str(divebar.file_id)) {
    return {
      ...base,
      source_type: 'divebar',
      source_ref: str(divebar.file_id),
      source_meta: { brand_code: kn.brand_code, disc_id: divebar.drive_path, format: divebar.format },
    };
  }
  return { ...base, source_type: 'kn', source_ref: str(kn.youtube_url) || str(kn.url), source_meta: { brand_code: kn.brand_code } };
}

/** What a tap on "Request this song" picks: the one version of a single-version song, else the auto-pick. */
export const defaultChoice = (song: SearchSong): SearchVersion | 'auto' =>
  song.versions.length === 1 && song.versions[0] ? song.versions[0] : 'auto';

/** After the last search/confirm screen loses focus, the flow is cleared this much later (unless one regained it). */
export const FLOW_LEAVE_GRACE_MS = 300;
let flowFocused = 0;

/**
 * Call in the search and confirm screens. Moving between them keeps the flow; leaving both (back to the night,
 * another tab) clears the pending pick and any change mode, so an abandoned change can't misroute a later request
 * (A.39, ruling E5-R4).
 */
export function useRequestFlowScope(): void {
  useFocusEffect(
    useCallback(() => {
      flowFocused += 1;
      return () => {
        flowFocused -= 1;
        setTimeout(() => {
          if (flowFocused === 0) useRequestStore.getState().clear();
        }, FLOW_LEAVE_GRACE_MS);
      };
    }, []),
  );
}
