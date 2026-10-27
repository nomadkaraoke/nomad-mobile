// A queued write on a record the server already counted is an edit (no extra performance); a queued delete of one
// subtracts what it contributed; a delete of a never-synced record subtracts nothing.
import { overlayLibrary, type MeSong, type PendingLog } from '@nomad/core';

import { libraryLog, pendingLog } from '../../me/pending';
import type { OutboxItem } from '../../tonight/log/outbox';

const item = (o: Partial<MeSong>): MeSong => ({
  key: 'u:cher|believe', song_key: null, artist: 'Cher', title: 'Believe', times_sung: 1, backfill_times: 0,
  feel_counts: { great: 0, ok: 0, bad: 0 }, latest_feel: null, latest_key: null, crowd_pleaser_count: 0, vibes: [],
  loved: false, hidden: false, setlist_ids: [], facets: null, ...o,
});
const mirror = (r: Partial<PendingLog>): ((id: string) => PendingLog | undefined) => {
  const rec: PendingLog = { id: 'app_1', artist: 'Cher', title: 'Believe', state: 'sung', ...r };
  return (id) => (id === rec.id ? rec : undefined);
};
const none = { loves: {}, setlists: [] };
const put = (patch: object): OutboxItem => ({ key: 'app_1', id: 'app_1', op: 'put', rev: 1, patch: patch as never });
const del: OutboxItem = { key: 'app_1', id: 'app_1', op: 'delete', rev: 2 };

it('an edited survey on a synced song sung once stays at one performance', () => {
  const feel = () => 'great';
  const log = libraryLog({}, [put({ state: 'sung', times: 1, artist: 'Cher', title: 'Believe', survey: { feel: 'bad' } })], {}, feel, mirror({ times: 1, survey: { feel: 'great' } }));
  expect(log[0]).toMatchObject({ synced: true, prev_feel: 'great' });
  const out = overlayLibrary([item({ feel_counts: { great: 1, ok: 0, bad: 0 }, latest_feel: 'great' })], { ...none, log });
  expect(out[0]).toMatchObject({ times_sung: 1, feel_counts: { great: 0, ok: 0, bad: 1 } });
});

it('a new record (not in the mirror) still counts', () => {
  const log = libraryLog({}, [put({ state: 'sung', artist: 'Cher', title: 'Believe' })], {}, undefined, () => undefined);
  expect(overlayLibrary([item({})], { ...none, log })[0]!.times_sung).toBe(2);
});

it('a queued delete of a synced backfill "sung x5" subtracts it and drops the item', () => {
  const log = libraryLog({}, [del], {}, undefined, mirror({ times: 5, origin: 'backfill' }));
  expect(log[0]).toMatchObject({ deleted: true, synced: true, times: 5, origin: 'backfill', artist: 'Cher' });
  expect(overlayLibrary([item({ times_sung: 5, backfill_times: 5 })], { ...none, log })).toEqual([]);
});

it('a queued delete of a synced feel=great record takes one great off', () => {
  const log = pendingLog([del], {}, undefined, mirror({ survey: { feel: 'great' } }));
  const out = overlayLibrary([item({ times_sung: 2, feel_counts: { great: 2, ok: 0, bad: 0 }, latest_feel: 'great' })], { ...none, log });
  expect(out[0]).toMatchObject({ times_sung: 1, feel_counts: { great: 1, ok: 0, bad: 0 } });
});

it('a delete of a record the mirror never had subtracts nothing', () => {
  const log = libraryLog({}, [del], {}, undefined, () => undefined);
  expect(overlayLibrary([item({})], { ...none, log })[0]!.times_sung).toBe(1);
});

it('a record sent this session then deleted does not subtract (the library cache never had it)', () => {
  const sent: Record<string, PendingLog> = { app_1: { id: 'app_1', artist: 'Cher', title: 'Believe', state: 'sung', synced: false } };
  const log = libraryLog(sent, [del], {}, undefined, mirror({ times: 1 }));
  expect(log).toEqual([]);
});

it('re-editing a synced crowd-pleaser survey keeps the count (prev answer read from the mirror)', () => {
  const log = libraryLog({}, [put({ state: 'sung', artist: 'Cher', title: 'Believe', survey: { crowd_pleaser: true } })], {}, undefined, mirror({ survey: { crowd_pleaser: true } }));
  expect(log[0]).toMatchObject({ synced: true, prev_crowd_pleaser: true });
  const out = overlayLibrary([item({ crowd_pleaser_count: 1 })], { ...none, log });
  expect(out[0]!.crowd_pleaser_count).toBe(1);
});
