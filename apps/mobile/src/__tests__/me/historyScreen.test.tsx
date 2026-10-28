// The uncatalogued-song page (Phase 4a, B9): me/history/[key].
import * as decide from '@nomad/api-decide';
import { libraryKey } from '@nomad/core';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import { useMakeIntent } from '../../make/intentStore';
import { appRoutes } from '../../test-utils/routes';
import { resetMe } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getLibrary: jest.fn(async () => ({ notModified: false, etag: 'e', items: [] })),
  listSetlists: jest.fn(async () => []),
  listKaraokeLog: jest.fn(async () => ({
    entries: [
      {
        id: 'app_u', user_id: 'u', source: 'app', state: 'sung', artist: 'Nobody', title: 'Odd Tune',
        song_key: null, song_key_status: 'unresolved', origin: 'backfill', times: 2, night: { kind: 'other', date_precision: 'unknown' },
      },
    ],
  })),
  listSongHistory: jest.fn(async () => []),
}));
void decide;

it('shows the song from route params with its history, and Make it uses the typed artist and title', async () => {
  resetMe();
  const key = libraryKey('Nobody', 'Odd Tune', null);
  const url = `/me/history/${encodeURIComponent(key)}?artist=Nobody&title=${encodeURIComponent('Odd Tune')}`;
  renderRouter({ ...appRoutes(), 'make/new': () => <View testID="make-stub" /> }, { initialUrl: url });
  expect(await screen.findByTestId('history-title')).toHaveTextContent(/Odd Tune/);
  expect(screen.getByTestId('history-artist')).toHaveTextContent(/Nobody/);
  expect(screen.queryByTestId('song-save')).toBeNull();
  expect(await screen.findByTestId('song-history-app_u')).toHaveTextContent(/Before the app ×2/);
  fireEvent.press(screen.getByTestId('history-make'));
  expect(await screen.findByTestId('make-stub')).toBeTruthy();
  expect(useMakeIntent.getState().get()).toMatchObject({ artist: 'Nobody', title: 'Odd Tune' });
});
