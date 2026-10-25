import * as decide from '@nomad/api-decide';
import { renderHook, waitFor } from '@testing-library/react-native';

import { useLogMirror } from '../../me/useLogMirror';
import { appStorage } from '../../storage';
import { userKeyFor } from '../../auth/userKey';
import { resetMe, wrapperFor } from './helpers';

jest.mock('@nomad/api-decide', () => ({ ...jest.requireActual('@nomad/api-decide'), listKaraokeLog: jest.fn() }));
const api = decide as jest.Mocked<typeof decide>;
const KEY = `me.logmirror.v1.${userKeyFor('a@example.com')}`;
const e = (id: string, o: Partial<decide.KaraokeLogEntry> = {}) =>
  ({ id, user_id: 'u', source: 'app', state: 'sung', artist: 'A', title: id, updated_at: '2026-10-01T00:00:00Z', ...o }) as decide.KaraokeLogEntry;

it('a full pull when there is no since, then a since sync applies updates and deletions', async () => {
  const client = resetMe();
  api.listKaraokeLog.mockResolvedValueOnce({ entries: [e('a'), e('b')] });
  const { result } = renderHook(() => useLogMirror(), { wrapper: wrapperFor(client) });
  await waitFor(() => expect(result.current.entries.map((x) => x.id).sort()).toEqual(['a', 'b']));
  expect(api.listKaraokeLog).toHaveBeenCalledWith(expect.not.objectContaining({ since: expect.anything() }));
  expect(JSON.parse(appStorage.getString(KEY)!).since).toBe('2026-10-01T00:00:00Z');

  api.listKaraokeLog.mockResolvedValueOnce({
    entries: [e('a', { deleted: true, updated_at: '2026-10-02T00:00:00Z' }), e('b', { title: 'B2', updated_at: '2026-10-03T00:00:00Z' }), e('c', { updated_at: '2026-10-03T00:00:00Z' })],
  });
  await client.invalidateQueries({ queryKey: ['decide'] });
  await waitFor(() => expect(result.current.entries.map((x) => x.id).sort()).toEqual(['b', 'c']));
  expect(api.listKaraokeLog).toHaveBeenLastCalledWith(expect.objectContaining({ since: '2026-10-01T00:00:00Z' }));
  expect(result.current.entries.find((x) => x.id === 'b')!.title).toBe('B2');
  expect(JSON.parse(appStorage.getString(KEY)!).since).toBe('2026-10-03T00:00:00Z');
});

it('pages with the cursor', async () => {
  const client = resetMe();
  api.listKaraokeLog.mockResolvedValueOnce({ entries: [e('a')], next_cursor: 'c1' }).mockResolvedValueOnce({ entries: [e('b')] });
  const { result } = renderHook(() => useLogMirror(), { wrapper: wrapperFor(client) });
  await waitFor(() => expect(result.current.entries).toHaveLength(2));
  expect(api.listKaraokeLog).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));
});
