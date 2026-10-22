import * as decide from '@nomad/api-decide';
import type { SongDetail } from '@nomad/api-decide';
import * as kjbox from '@nomad/api-kjbox';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { useNightStore } from '../../../tonight/nightStore';
import { useRequestStore } from '../../../tonight/request/requestStore';
import { appRoutes } from '../../../test-utils/routes';
import { group, kn, results } from '../request/helpers';
import { otherNight, signedInClean } from './setup';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getSongDetail: jest.fn(),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
}));
jest.mock('@nomad/api-kjbox', () => ({ ...jest.requireActual('@nomad/api-kjbox'), searchSongs: jest.fn() }));
jest.mock('../../../offline/offlineIndex', () => ({
  openOfflineReader: () => null,
  maybeRefreshOfflineIndex: async () => {},
  useOfflineIndex: () => ({ status: 'none', downloadedAt: null, bytes: null, progress: null, download: jest.fn(), remove: jest.fn() }),
}));

const dapi = decide as jest.Mocked<typeof decide>;
const kapi = kjbox as jest.Mocked<typeof kjbox>;

const detail: SongDetail = {
  song: { artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight', karaoke: true },
  versions: [{ brand_code: 'C1', brand_name: 'Community', kind: 'community', youtube_url: null, rank: 0 }],
};

function Params({ testID }: { testID: string }) {
  const p = useLocalSearchParams();
  return (
    <View testID={testID}>
      <Text testID={`${testID}-params`}>{JSON.stringify(p)}</Text>
    </View>
  );
}
const routes = () => ({
  ...appRoutes(),
  'tonight/add': () => <Params testID="add-stub" />,
  'tonight/search': () => <Params testID="search-stub" />,
  'tonight/confirm': () => <View testID="confirm-stub" />,
});
const params = (id: string) => JSON.parse(screen.getByTestId(`${id}-params`).props.children as string) as Record<string, string>;

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  signedInClean();
  useRequestStore.getState().clear();
  dapi.getSongDetail.mockResolvedValue(detail);
});

describe('song page action adapts to night kind (E9-R5)', () => {
  it('is hidden with no night', async () => {
    renderRouter(routes(), { initialUrl: '/song/muse%7Cstarlight' });
    expect(await screen.findByTestId('song-make')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Starlight')).toBeTruthy());
    expect(screen.queryByTestId('song-tonight-action')).toBeNull();
  });

  it('"Add to tonight" during an Other night opens add with the song', async () => {
    otherNight();
    renderRouter(routes(), { initialUrl: '/song/muse%7Cstarlight' });
    const action = await screen.findByTestId('song-tonight-action');
    expect(screen.getByText('Add to tonight')).toBeTruthy();
    fireEvent.press(action);
    expect(await screen.findByTestId('add-stub')).toBeTruthy();
    expect(params('add-stub')).toEqual(expect.objectContaining({ artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight' }));
  });

  it('"Request tonight" during a Nomad night opens confirm with the matching song', async () => {
    useNightStore.getState().joinNomad('2121', 'n1', 'Andrew');
    const match = group('Starlight', 'Muse', [kn(1)]);
    kapi.searchSongs.mockResolvedValue(results([group('Starlight (Live)', 'Someone Else'), match]));
    renderRouter(routes(), { initialUrl: '/song/muse%7Cstarlight' });
    const action = await screen.findByTestId('song-tonight-action');
    expect(screen.getByText('Request tonight')).toBeTruthy();
    fireEvent.press(action);
    expect(await screen.findByTestId('confirm-stub')).toBeTruthy();
    expect(kapi.searchSongs).toHaveBeenCalledWith('2121', 'Muse Starlight', undefined, 'n1');
    expect(useRequestStore.getState().pending?.song).toBe(match);
    expect(useRequestStore.getState().pending?.version).toEqual(kn(1));
  });

  it('"Request tonight" with no artist + title match opens the results for that query', async () => {
    useNightStore.getState().joinNomad('2121', 'n1', 'Andrew');
    kapi.searchSongs.mockResolvedValue(results([group('Starlight (Live)', 'Someone Else')]));
    renderRouter(routes(), { initialUrl: '/song/muse%7Cstarlight' });
    fireEvent.press(await screen.findByTestId('song-tonight-action'));
    expect(await screen.findByTestId('search-stub')).toBeTruthy();
    expect(params('search-stub')).toEqual(expect.objectContaining({ q: 'Muse Starlight' }));
    expect(useRequestStore.getState().pending).toBeNull();
  });

  it('"Request tonight" opens the results when the box search fails', async () => {
    useNightStore.getState().joinNomad('2121', 'n1', 'Andrew');
    kapi.searchSongs.mockRejectedValue(new Error('down'));
    renderRouter(routes(), { initialUrl: '/song/muse%7Cstarlight' });
    fireEvent.press(await screen.findByTestId('song-tonight-action'));
    expect(await screen.findByTestId('search-stub')).toBeTruthy();
  });
});
