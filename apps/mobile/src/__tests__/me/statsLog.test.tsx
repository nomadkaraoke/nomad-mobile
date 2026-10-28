// StatsCard's "This year" reads the log mirror merged with Tonight's still-queued writes (Phase 4a final review, minor 5).
import * as decide from '@nomad/api-decide';
import { karaokeStats } from '@nomad/core';
import { act, renderHook } from '@testing-library/react-native';

import { userKeyFor } from '../../auth/userKey';
import { useStatsLog } from '../../me/useStatsLog';
import { appStorage } from '../../storage';
import { useLogStore } from '../../tonight/log/logStore';
import { useOutbox } from '../../tonight/log/outbox';
import { resetMe, wrapperFor } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  listKaraokeLog: jest.fn(() => new Promise(() => {})),
}));
void decide;

const year = new Date().getFullYear();
const at = `${year}-03-04T21:00:00Z`;

it('counts queued writes and drops queued deletes (deduped by id) for This year', () => {
  const client = resetMe();
  appStorage.set(
    `me.logmirror.v1.${userKeyFor('a@example.com')}`,
    JSON.stringify({
      entries: [
        { id: 'app_keep', user_id: 'u', state: 'sung', artist: 'A', title: 'Kept', sung_at: at },
        { id: 'app_gone', user_id: 'u', state: 'sung', artist: 'A', title: 'Gone', sung_at: at },
        { id: 'app_edit', user_id: 'u', state: 'sung', artist: 'A', title: 'Edited', sung_at: at, survey: { feel: 'great' } },
      ],
    }),
  );
  const { result } = renderHook(() => useStatsLog(), { wrapper: wrapperFor(client) });
  const thisYear = () => karaokeStats([], result.current, { year });
  expect(thisYear().performances).toBe(3);
  act(() => {
    useLogStore.setState({
      entries: {
        app_new: { id: 'app_new', source: 'app', state: 'sung', artist: 'B', title: 'New', sung_at: at, updatedAt: 1 },
        app_edit: { id: 'app_edit', source: 'app', state: 'sung', artist: 'A', title: 'Edited', sung_at: at, updatedAt: 1 },
      },
    });
    useOutbox.setState({
      items: [
        { key: 'app_new', id: 'app_new', op: 'put', rev: 1, patch: { artist: 'B', title: 'New', state: 'sung', sung_at: at } as never },
        { key: 'app_gone', id: 'app_gone', op: 'delete', rev: 2 },
        { key: 'app_edit', id: 'app_edit', op: 'put', rev: 3, patch: { survey: { feel: 'ok' } } as never },
      ],
    });
  });
  expect(result.current.map((r) => r.id).sort()).toEqual(['app_edit', 'app_keep', 'app_new']);
  expect(thisYear().performances).toBe(3); // Kept + New + Edited (a survey-only edit still counts once)
  expect(result.current.find((r) => r.id === 'app_edit')).toMatchObject({ state: 'sung', survey: { feel: 'ok' } });
});
