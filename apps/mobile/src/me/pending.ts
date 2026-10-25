import type { Setlist } from '@nomad/api-decide';
import type { MeSong, PendingLog, PendingLoves, PendingSetlist } from '@nomad/core';

import type { LogEntry } from '../tonight/log/logStore';
import type { OutboxItem } from '../tonight/log/outbox';
import type { MeOutboxItem } from './meOutbox';

/**
 * Tonight-outbox items (unsynced karaoke-log writes) as pending records for the overlay.
 * `state`, `times`, `sung_at` and `origin` come ONLY from the queued patch: a survey-only put on a record the server
 * already counted must not count it again (its state is 'survey', which never counts as sung, so the survey applies
 * to existing library items only). Accepted limitation: a queued delete of an already-synced record does not subtract
 * from the cached counts (the overlay only adds).
 */
export function pendingLog(items: OutboxItem[], entries: Record<string, LogEntry>): PendingLog[] {
  const out: PendingLog[] = [];
  for (const it of items) {
    const e = entries[it.id];
    if (it.op === 'delete') {
      if (e) out.push({ id: it.id, artist: e.artist, title: e.title, song_key: e.song_key, state: e.state, deleted: true });
      continue;
    }
    const p = it.patch as Record<string, unknown>;
    const artist = (p.artist as string | undefined) ?? e?.artist;
    const title = (p.title as string | undefined) ?? e?.title;
    if (!artist || !title) continue;
    // The survey too comes only from the patch: an already-synced survey in the log store must not be re-applied.
    const survey = (p.survey as object | undefined) ?? {};
    out.push({
      id: it.id,
      artist,
      title,
      song_key: (p.song_key as string | undefined) ?? e?.song_key,
      state: it.patch.state ?? 'survey',
      times: it.patch.times,
      origin: it.patch.origin,
      survey: Object.keys(survey).length ? (survey as PendingLog['survey']) : undefined,
      sung_at: it.patch.sung_at,
      night: (p.night ?? e?.night) as PendingLog['night'] | undefined,
    });
  }
  return out;
}

export function pendingLoves(items: MeOutboxItem[]): PendingLoves {
  const out: PendingLoves = {};
  for (const it of items) {
    if (it.op === 'love') out[it.song_key] = { loved: it.loved, artist: it.artist, title: it.title, song_key: it.song_key };
  }
  return out;
}

export function pendingSetlists(items: MeOutboxItem[]): PendingSetlist[] {
  const out: PendingSetlist[] = [];
  for (const it of items) {
    if (it.op === 'save') {
      out.push({ id: it.id, items: it.items.map((x) => ({ song_key: x.song_key ?? null, artist: x.artist ?? '', title: x.title ?? '' })) });
    } else if (it.op === 'delete') out.push({ id: it.id, items: [], deleted: true });
  }
  return out;
}

/** Server setlists with the queued saves and deletes applied (a queued create appears at once). */
export function overlaySetlists(base: Setlist[], items: MeOutboxItem[], now = new Date().toISOString()): Setlist[] {
  const out = [...base];
  for (const it of items) {
    if (it.op === 'love') continue;
    const i = out.findIndex((s) => s.id === it.id);
    if (it.op === 'delete') {
      if (i >= 0) out.splice(i, 1);
      continue;
    }
    const cur = i >= 0 ? out[i]! : undefined;
    const prevById = new Map((cur?.items ?? []).map((x) => [x.item_id, x]));
    const next: Setlist = {
      id: it.id,
      name: it.name,
      description: cur?.description ?? null,
      song_ids: cur?.song_ids ?? [],
      song_count: it.items.length,
      created_at: cur?.created_at ?? now,
      updated_at: now,
      rev: cur?.rev ?? 0,
      items: it.items.map((x, n) => {
        const known = x.item_id ? prevById.get(x.item_id) : undefined;
        return {
          item_id: x.item_id ?? known?.item_id ?? `local-${it.id}-${n}`,
          song_key: x.song_key ?? null,
          artist: x.artist ?? '',
          title: x.title ?? '',
          added_at: known?.added_at ?? now,
          facets: known?.facets ?? null,
        };
      }),
    };
    if (i >= 0) out[i] = next;
    else out.push(next);
  }
  return out;
}

/** Wire library item (optional fields) to the core's MeSong. */
export function toMeSong(x: import('@nomad/api-decide').LibraryItem): MeSong {
  return {
    key: x.key,
    song_key: x.song_key ?? null,
    artist: x.artist,
    title: x.title,
    times_sung: x.times_sung ?? 0,
    backfill_times: x.backfill_times ?? 0,
    first_sung_at: x.first_sung_at ?? null,
    last_sung_at: x.last_sung_at ?? null,
    feel_counts: { great: 0, ok: 0, bad: 0, ...(x.feel_counts ?? {}) },
    latest_feel: x.latest_feel ?? null,
    latest_key: x.latest_key ?? null,
    crowd_pleaser_count: x.crowd_pleaser_count ?? 0,
    vibes: [...(x.vibes ?? [])],
    loved: x.loved ?? false,
    hidden: x.hidden ?? false,
    setlist_ids: [...(x.setlist_ids ?? [])],
    facets: x.facets ? ({ ...x.facets } as MeSong['facets']) : null,
  };
}
