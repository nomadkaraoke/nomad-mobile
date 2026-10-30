// wipeLocal (Phase 6 M4): after gen deleted the account, the phone is left as if freshly installed, and nothing
// calls a server on the way (gen already erased the push tokens and recordings).
import * as apiGen from '@nomad/api-gen';
import * as apiKjbox from '@nomad/api-kjbox';
import { QueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import { useAuth } from '../../auth/store';
import { useImportQueue } from '../../discover/connect/importQueue';
import { useMakeIntent } from '../../make/intentStore';
import { resetObservability } from '../../observability';
import { removeOfflineIndex } from '../../offline/offlineIndex';
import { appStorage } from '../../storage';
import { fsState } from '../../test-utils/memoryFs';
import { useNightStore } from '../../tonight/nightStore';
import { profileFromSelfReport, useVoiceStore } from '../../voice/voiceStore';
import { useRecordingQueue } from '../../voiceSession/recording/recordingQueue';
import { wipeLocal } from '../wipeLocal';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories can't use imports
jest.mock('expo-file-system', () => require('../../test-utils/memoryFs'));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  deleteExpoToken: jest.fn(async () => {}),
  deleteVoiceRecordings: jest.fn(async () => ({})),
}));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  uploadExportChunk: jest.fn(async () => ({})),
  deleteVoiceRecordings: jest.fn(async () => ({})),
}));
jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  deleteKjboxPushToken: jest.fn(async () => {}),
}));
const mockLogOut = jest.fn(async () => {});
jest.mock('../../credits/purchases', () => ({ getPurchases: () => ({ logOut: mockLogOut }) }));
jest.mock('../../observability', () => ({ ...jest.requireActual('../../observability'), resetObservability: jest.fn() }));
jest.mock('../../offline/offlineIndex', () => ({ removeOfflineIndex: jest.fn(async () => {}) }));

const cancelAll = Notifications.cancelAllScheduledNotificationsAsync as jest.Mock;

const SESSION = { token: 'tok-me', email: 'me@example.com', credits: 1, creditsGranted: 0 };

beforeEach(async () => {
  jest.clearAllMocks();
  fsState.reset();
  appStorage.clearAll();
  await useAuth.getState().signInWithSession(SESSION, 'apple');
});

it('clears every store and queue', async () => {
  // Push: a registered token (gen and a night) and an older pending unregister.
  appStorage.set('push.expoToken.v1', 'ExponentPushToken[me]');
  appStorage.set('push.kjboxNight.v1', 'night-1');
  await SecureStore.setItemAsync(
    'push.pendingUnregister.v1',
    JSON.stringify({ token: 'ExponentPushToken[old]', bearer: 'old', attempts: 0 }),
  );
  // Discover's import queue (sign-out alone keeps it), a recording take, the voice profile, a make intent, a night.
  useImportQueue.getState().enqueue([{ endpoint: 'spotify-extended', body: { tracks: [] } } as never], 'spotify');
  expect(useImportQueue.getState().pending).toHaveLength(1);
  const payloads = () => [...fsState.files.keys()].filter((k) => k.includes('/imports/'));
  expect(payloads()).toHaveLength(1);
  useRecordingQueue.getState().enqueue({
    sessionId: 's1',
    attemptN: 1,
    durationS: 30,
    uri: 'file:///document/take-1.m4a',
    contentType: 'audio/mp4',
  } as never);
  expect(useRecordingQueue.getState().items).toHaveLength(1);
  useVoiceStore.getState().save(profileFromSelfReport('tenor', '2026-10-22T00:00:00.000Z'));
  useMakeIntent.getState().set({ artist: 'Alpha Band', title: 'Invented Song', source: 'typed', createdAt: Date.now(), editedFields: [] } as never);
  useNightStore.getState().joinNomad('2121', 'aaaaaaaaaaaaaaaa', 'Sam');
  const queryClient = new QueryClient();
  queryClient.setQueryData(['me', 'me@example.com'], { credits: 3 });
  appStorage.set('some.other.key', 'x');
  // Downloaded videos (jobs/downloadMp4.ts) sit in the cache beside other cache files.
  fsState.files.set('file:///cache/nomad-job1-720p.mp4', new Uint8Array([1]));
  fsState.files.set('file:///cache/nomad-job2-720p.mp4', new Uint8Array([1]));
  fsState.files.set('file:///cache/other.bin', new Uint8Array([1]));

  await wipeLocal({ queryClient });

  // Signed out, session gone from SecureStore, no server call of any kind.
  expect(useAuth.getState().state.status).toBe('signedOut');
  expect(await SecureStore.getItemAsync('nomad.session.v1')).toBeNull();
  expect(await SecureStore.getItemAsync('push.pendingUnregister.v1')).toBeNull();
  expect(apiGen.deleteExpoToken).not.toHaveBeenCalled();
  expect(apiKjbox.deleteKjboxPushToken).not.toHaveBeenCalled();
  // Queues and stores.
  expect(useImportQueue.getState().pending).toEqual([]);
  expect(payloads()).toEqual([]);
  expect(useRecordingQueue.getState().items).toEqual([]);
  expect(useVoiceStore.getState().profile).toBeNull();
  expect(useMakeIntent.getState().intent).toBeNull();
  expect(useNightStore.getState().active).toBeNull();
  expect(queryClient.getQueryData(['me', 'me@example.com'])).toBeUndefined();
  // Store customer, analytics, reminders, offline list.
  expect(mockLogOut).toHaveBeenCalled();
  expect(resetObservability).toHaveBeenCalled();
  expect(cancelAll).toHaveBeenCalled();
  expect(removeOfflineIndex).toHaveBeenCalled();
  expect(fsState.files.has('file:///cache/nomad-job1-720p.mp4')).toBe(false);
  expect(fsState.files.has('file:///cache/nomad-job2-720p.mp4')).toBe(false);
  expect(fsState.files.has('file:///cache/other.bin')).toBe(true);
  // MMKV is empty (the push token included).
  expect(appStorage.getString('some.other.key')).toBeUndefined();
  expect(appStorage.getString('push.expoToken.v1')).toBeUndefined();
});

it('a failing step never stops the ones after it', async () => {
  (removeOfflineIndex as jest.Mock).mockRejectedValueOnce(new Error('boom'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  appStorage.set('some.other.key', 'x');
  await wipeLocal();
  expect(warn).toHaveBeenCalledWith('[wipeLocal] offline song list failed', expect.any(Error));
  expect(cancelAll).toHaveBeenCalled();
  expect(appStorage.getString('some.other.key')).toBeUndefined();
  warn.mockRestore();
});
