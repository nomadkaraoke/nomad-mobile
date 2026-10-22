// Shared setup for the manage-songs tests (not a test file: no `.test.` in the name). Each test file declares its own
// jest.mock('@nomad/api-kjbox') (mocks hoist per file) and calls these from beforeEach.
import type * as kjbox from '@nomad/api-kjbox';
import { act } from '@testing-library/react-native';

import { useAuth } from '../../../auth/store';
import { appStorage } from '../../../storage';
import { usePhoneStore } from '../../../tonight/manage/PhoneSheet';
import { manageTiming } from '../../../tonight/manage/SongActions';
import { useNightStore, type NomadNight } from '../../../tonight/nightStore';
import { useEditingStore } from '../../../tonight/nomad/editingStore';
import { NightScreen } from '../../../tonight/nomad/NightScreen';
import { nightPoll } from '../../../tonight/nomad/queries';
import { me, nightOpen, nowResult, renderTonight, rotationResult } from '../../../test-utils/tonightFixtures';

export const NIGHT_ID = 'aaaaaaaaaaaaaaaa';
export const DEFAULT_POLL = { ...nightPoll, backoffMs: [...nightPoll.backoffMs] };
export const DEFAULT_TIMING = { ...manageTiming };
export const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

export const requestResult = (over: Partial<kjbox.SongRequest> = {}): kjbox.RequestResult => ({
  api_version: '1.0',
  auto_approved: true,
  request: {
    id: 9,
    singer_name: 'Sam',
    song_artist: 'Muse',
    song_title: 'Starlight',
    source_type: 'local',
    status: 'approved',
    created_at: null,
    linked_entry_id: 3,
    additional_singers: null,
    supersedes_request_id: null,
    media_consent: null,
    for_friend: false,
    ...over,
  },
});

/** Signed in as sam@example.com, joined night 2121, slow polls, short notices, fresh stores. */
export function setupNight(api: jest.Mocked<typeof kjbox>): NomadNight {
  jest.useRealTimers();
  jest.clearAllMocks();
  appStorage.clearAll();
  usePhoneStore.setState({ phones: {} });
  Object.assign(nightPoll, { meMs: 60_000, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000, closedMs: 60_000, backoffMs: [60_000] });
  Object.assign(manageTiming, { noticeMs: 300, consentDebounceMs: 60 });
  useEditingStore.setState({ editing: false, sheets: 0 });
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email: 'sam@example.com', createdAt: 0 } } });
  useNightStore.getState().rehydrate('sam@example.com');
  useNightStore.getState().joinNomad('2121', NIGHT_ID, 'Andrew');
  api.getMe.mockResolvedValue(me());
  api.getNow.mockResolvedValue(nowResult());
  api.getRotation.mockResolvedValue({ etag: '"7"', data: rotationResult([]) });
  api.getNight.mockResolvedValue(nightOpen());
  return useNightStore.getState().current() as NomadNight;
}

export function restoreTiming() {
  Object.assign(nightPoll, DEFAULT_POLL);
  Object.assign(manageTiming, DEFAULT_TIMING);
}

export const showNight = (night: NomadNight) => renderTonight(<NightScreen night={night} focused />);
