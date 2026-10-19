import { create } from 'zustand';

import { appStorage } from '../storage';

export type MakeField = 'artist' | 'title';
const FIELDS: MakeField[] = ['artist', 'title'];

/**
 * The song someone tapped "Make it" on (spec §4.3). Survives sign-in, checkout and an app kill (spec §7).
 *
 * `artist`/`title` are what the make flow searches for. `source: 'identified'`: a song decide knows (the song
 * page, the missing card), so they equal the canonical values. `source: 'typed'`: the free-text "make any
 * song" form; the canonical values are the identification it was pre-filled from (if any) and
 * `editedFields` the fields the user changed, which nothing may overwrite later (kjbox D10).
 */
export type MakeIntent = {
  artist: string;
  title: string;
  canonicalArtist?: string;
  canonicalTitle?: string;
  songKey?: string;
  source: 'identified' | 'typed';
  editedFields: MakeField[];
  createdAt: number;
};

/** The "make any song" form while it is being filled in (memory only). */
export type MakeDraft = Omit<MakeIntent, 'source' | 'createdAt'>;
export const EMPTY_DRAFT: MakeDraft = { artist: '', title: '', editedFields: [] };

/**
 * What to pre-fill from: a song decide identified (decide's SongRef shape, with its `song_key`), or just an
 * artist/title split of the typed words (no `song_key`: not canonical).
 */
export type SongIdentity = { artist: string; title: string; song_key?: string };

const KEY = 'make.intent.v1';
/** Older than this, the person has moved on: don't drop them back into a make flow. */
export const INTENT_TTL_MS = 30 * 60 * 1000;

export const isFreshIntent = (i: MakeIntent | null, now = Date.now()): i is MakeIntent =>
  i !== null && now - i.createdAt <= INTENT_TTL_MS;

/** "Make it" on a song decide identified: exactly its canonical artist/title. */
export const identifiedIntent = (song: Required<SongIdentity>, now = Date.now()): MakeIntent => ({
  artist: song.artist,
  title: song.title,
  canonicalArtist: song.artist,
  canonicalTitle: song.title,
  songKey: song.song_key,
  source: 'identified',
  editedFields: [],
  createdAt: now,
});

/** "Make it" on the free-text form: the trimmed fields, plus the pre-fill and the edits behind them. */
export const typedIntent = (draft: MakeDraft, now = Date.now()): MakeIntent => ({
  ...draft,
  artist: draft.artist.trim(),
  title: draft.title.trim(),
  source: 'typed',
  createdAt: now,
});

/**
 * Pre-fills the form from the current identification (null: none, e.g. a new query): every field the user
 * hasn't edited follows it; an edited field is never touched (kjbox `prefillMake`, spec A95). The canonical
 * values follow an identified song only.
 */
export function prefillMake(draft: MakeDraft, src: SongIdentity | null): MakeDraft {
  const next: MakeDraft = { artist: draft.artist, title: draft.title, editedFields: draft.editedFields };
  for (const f of FIELDS) {
    if (!draft.editedFields.includes(f)) next[f] = src?.[f] ?? '';
  }
  if (src?.song_key) {
    next.canonicalArtist = src.artist;
    next.canonicalTitle = src.title;
    next.songKey = src.song_key;
  }
  return next;
}

/** The user typed in a field: it is theirs from now on. */
export const editMake = (draft: MakeDraft, field: MakeField, value: string): MakeDraft => ({
  ...draft,
  [field]: value,
  editedFields: draft.editedFields.includes(field) ? draft.editedFields : [...draft.editedFields, field],
});

const str = (v: unknown): v is string => typeof v === 'string';

function load(): MakeIntent | null {
  try {
    const raw = appStorage.getString(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (v && str(v.artist) && str(v.title) && typeof v.createdAt === 'number') {
      // Intents stored before canonical values existed load as typed with no edits.
      const edited = Array.isArray(v.editedFields) ? v.editedFields : [];
      return {
        artist: v.artist,
        title: v.title,
        ...(str(v.canonicalArtist) ? { canonicalArtist: v.canonicalArtist } : {}),
        ...(str(v.canonicalTitle) ? { canonicalTitle: v.canonicalTitle } : {}),
        ...(str(v.songKey) ? { songKey: v.songKey } : {}),
        source: v.source === 'identified' ? 'identified' : 'typed',
        editedFields: FIELDS.filter((f) => edited.includes(f)),
        createdAt: v.createdAt,
      };
    }
  } catch {
    // Corrupt: treated as no intent.
  }
  appStorage.remove(KEY);
  return null;
}

type IntentStore = {
  /** Raw stored intent (may be stale); read through get() or isFreshIntent(). */
  intent: MakeIntent | null;
  /** The "make any song" form, kept while the user moves between Discover and the form. */
  draft: MakeDraft;
  set(i: MakeIntent): void;
  /** Forgets the intent and the form (a job was made). */
  clear(): void;
  /**
   * The intent, or null once it's older than 30 minutes. Clears an expired intent (a state update), so call it
   * from handlers/effects, not during render; render code reads `intent` through isFreshIntent().
   */
  get(): MakeIntent | null;
  /** Discover's current identification (null: none): see prefillMake. */
  prefill(src: SongIdentity | null): void;
  /** The user typed in the form. */
  edit(field: MakeField, value: string): void;
};

export const useMakeIntent = create<IntentStore>((setState, getState) => ({
  intent: load(),
  draft: EMPTY_DRAFT,

  set(intent) {
    appStorage.set(KEY, JSON.stringify(intent));
    setState({ intent });
  },

  clear() {
    appStorage.remove(KEY);
    setState({ intent: null, draft: EMPTY_DRAFT });
  },

  get() {
    const { intent } = getState();
    if (intent === null) return null;
    if (isFreshIntent(intent)) return intent;
    appStorage.remove(KEY); // expired: the form being filled in (if any) stays
    setState({ intent: null });
    return null;
  },

  prefill(src) {
    setState({ draft: prefillMake(getState().draft, src) });
  },

  edit(field, value) {
    setState({ draft: editMake(getState().draft, field, value) });
  },
}));
