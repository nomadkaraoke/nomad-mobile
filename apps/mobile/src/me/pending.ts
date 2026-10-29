import type { KaraokeLogPatch, Setlist } from '@nomad/api-decide';
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
 * `syncedFeel(id)`: the feel the server already counted for that record (the log mirror's survey), so a re-edited
 * survey moves the count instead of adding one (`prev_feel`).
 */
export function pendingLog(
  items: OutboxItem[],
  entries: Record<string, LogEntry>,
  syncedFeel?: (id: string) => string | null | undefined,
  syncedRec?: (id: string) => PendingLog | undefined,
): PendingLog[] {
  const out: PendingLog[] = [];
  for (const it of items) {
    const e = entries[it.id];
    const mirrored = syncedRec?.(it.id);
    if (it.op === 'delete') {
      if (mirrored) {
        const feel = mirrored.survey?.feel;
        const crowd = mirrored.survey?.crowd_pleaser;
        out.push({
          id: it.id,
          artist: mirrored.artist,
          title: mirrored.title,
          song_key: mirrored.song_key,
          state: mirrored.state,
          times: mirrored.times,
          origin: mirrored.origin,
          survey: feel || crowd ? { ...(feel ? { feel } : {}), ...(crowd ? { crowd_pleaser: true } : {}) } : undefined,
          sung_at: mirrored.sung_at,
          deleted: true,
          synced: true,
        });
      } else if (e) out.push({ id: it.id, artist: e.artist, title: e.title, song_key: e.song_key, state: e.state, deleted: true });
      continue;
    }
    const p = it.patch as Record<string, unknown>;
    const artist = (p.artist as string | undefined) ?? e?.artist;
    const title = (p.title as string | undefined) ?? e?.title;
    if (!artist || !title) continue;
    // The survey too comes only from the patch: an already-synced survey in the log store must not be re-applied.
    const survey = (p.survey as object | undefined) ?? {};
    const prev = (survey as { feel?: unknown }).feel ? syncedFeel?.(it.id) : undefined;
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
      ...(prev ? { prev_feel: prev } : {}),
      ...(mirrored || prev ? { synced: true } : {}),
      ...(mirrored ? { prev_crowd_pleaser: !!mirrored.survey?.crowd_pleaser } : {}),
    });
  }
  return out;
}

/**
 * A later queued write folded onto a record already sent (still "settling": the library cache predates it). Fields
 * the patch didn't set keep the sent record's value; `prev_feel` stays the one the server had before both.
 */
export function foldLog(old: PendingLog | undefined, rec: PendingLog, patch: KaraokeLogPatch | undefined): PendingLog {
  if (!old || rec.deleted || !patch) return rec;
  return {
    ...old,
    artist: rec.artist,
    title: rec.title,
    song_key: rec.song_key ?? old.song_key,
    state: patch.state !== undefined ? rec.state : old.state,
    times: patch.times !== undefined ? rec.times : old.times,
    origin: patch.origin !== undefined ? rec.origin : old.origin,
    sung_at: rec.sung_at ?? old.sung_at,
    night: rec.night ?? old.night,
    survey: old.survey || rec.survey ? { ...old.survey, ...rec.survey } : undefined,
    prev_feel: old.prev_feel,
    prev_crowd_pleaser: old.prev_crowd_pleaser,
  };
}

/**
 * The log records the library overlay applies: writes sent but not yet seen by a library fetch (`settled`), with the
 * ones still queued folded on top (a queued delete drops the record).
 */
export function libraryLog(
  settled: Record<string, PendingLog>,
  items: OutboxItem[],
  entries: Record<string, LogEntry>,
  syncedFeel?: (id: string) => string | null | undefined,
  syncedRec?: (id: string) => PendingLog | undefined,
): PendingLog[] {
  const out = new Map(Object.entries(settled));
  for (const it of items) if (it.op === 'delete') out.delete(it.id);
  const feel = (id: string) => settled[id]?.survey?.feel ?? syncedFeel?.(id);
  for (const rec of pendingLog(items, entries, feel, syncedRec)) {
    const it = items.find((i) => i.id === rec.id);
    const old = settled[rec.id];
    // A record sent earlier this session keeps the answer it had when it was sent: the mirror may have caught up
    // since, which says nothing about whether the library cache has.
    if (old && !old.deleted) {
      if (rec.deleted) {
        // Deleting a record sent here: its counts are only in the library cache if it was an edit of a synced one.
        if (old.synced) out.set(rec.id, { ...old, deleted: true });
        else out.delete(rec.id);
        continue;
      }
      out.set(rec.id, { ...foldLog(old, rec, it?.op === 'put' ? it.patch : undefined), synced: old.synced });
      continue;
    }
    out.set(rec.id, rec.deleted && !rec.synced ? rec : foldLog(undefined, rec, undefined));
  }
  return [...out.values()];
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
    if (it.op === 'love' || it.op === 'dismiss') continue;
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
