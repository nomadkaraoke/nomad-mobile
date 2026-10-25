import type { KaraokeLogEntry } from '@nomad/api-decide';

import { toPendingLog } from '../../me/useLogMirror';

it('maps wire nulls to absent fields and keeps the night and survey', () => {
  const e = {
    id: 'a', user_id: '', source: 'app', state: null, artist: 'X', title: 'Y', song_key: null, times: 2, origin: null, sung_at: '2026-01-02',
    survey: { feel: 'great', key: null, crowd_pleaser: true, vibes: ['party'] },
    night: { id: 'n1', kind: 'other', venue_name: null, date: '2026-01-02' },
  } as unknown as KaraokeLogEntry;
  const [r] = toPendingLog([e]);
  expect(r).toMatchObject({ id: 'a', artist: 'X', state: '', times: 2, song_key: null, origin: undefined, sung_at: '2026-01-02' });
  expect(r!.survey).toMatchObject({ feel: 'great', crowd_pleaser: true, vibes: ['party'] });
  expect(r!.survey!.key).toBeUndefined();
  expect(r!.night).toEqual({ id: 'n1', date: '2026-01-02', venue_name: undefined, kind: 'other' });
});

it('blank names for a record without them', () => {
  const [r] = toPendingLog([{ id: 'b', source: 'app', user_id: '' } as KaraokeLogEntry]);
  expect(r).toMatchObject({ artist: '', title: '', state: '' });
  expect(r!.survey).toBeUndefined();
});
