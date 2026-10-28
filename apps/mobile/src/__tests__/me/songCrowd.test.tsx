// SongCrowdLine (Phase 4b, D5): the song page's crowd singability line, rendered only from what decide sends
// (thresholds are server-side; the phone never derives a figure decide didn't give it).
import * as decide from '@nomad/api-decide';
import type { SongCrowd } from '@nomad/api-decide';
import { act, screen, waitFor } from '@testing-library/react-native';

import { useAuth } from '../../auth/store';
import { SongCrowdLine } from '../../me/SongCrowdLine';
import { renderTonight } from '../../test-utils/tonightFixtures';
import { resetMe } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getSongCrowd: jest.fn(),
}));

let mockConnected = true;
jest.mock('@react-native-community/netinfo', () => {
  const actual = jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js');
  return { ...actual, useNetInfo: () => ({ isConnected: mockConnected, isInternetReachable: mockConnected }) };
});

const api = decide as jest.Mocked<typeof decide>;
const NULLS: SongCrowd = {
  singers: null,
  comfortable_share: null,
  too_high_share: null,
  too_low_share: null,
  bucket: null,
  bucket_singers: null,
  bucket_comfortable_share: null,
  crowd_pleaser_share: null,
};
const crowd = (o: Partial<SongCrowd>): SongCrowd => ({ ...NULLS, ...o });

const KEY = 'invented band|made up song';

beforeEach(() => {
  jest.clearAllMocks();
  mockConnected = true;
  resetMe();
});

it('with a bucket figure: "100% of baritones found the key comfortable" (me-12 seed shape)', async () => {
  api.getSongCrowd.mockResolvedValue(
    crowd({
      singers: 6, comfortable_share: 0.8333, too_high_share: 0.1667, too_low_share: 0,
      bucket: 'baritone', bucket_singers: 5, bucket_comfortable_share: 1,
    }),
  );
  renderTonight(<SongCrowdLine songKey={KEY} />);
  expect(await screen.findByTestId('song-crowd')).toHaveTextContent('100% of baritones found the key comfortable');
  expect(api.getSongCrowd).toHaveBeenCalledWith(KEY);
});

it.each([
  ['bass', 'basses'],
  ['tenor', 'tenors'],
  ['alto', 'altos'],
  ['mezzo', 'mezzo-sopranos'],
  ['soprano', 'sopranos'],
])('bucket %s reads "72%% of %s…"', async (bucket, plural) => {
  api.getSongCrowd.mockResolvedValue(
    crowd({ singers: 11, comfortable_share: 0.7273, bucket, bucket_singers: 7, bucket_comfortable_share: 0.7203 }),
  );
  renderTonight(<SongCrowdLine songKey={KEY} />);
  expect(await screen.findByTestId('song-crowd')).toHaveTextContent(`72% of ${plural} found the key comfortable`);
});

it('without a bucket figure: the overall "8 of 11 singers found the key comfortable"', async () => {
  api.getSongCrowd.mockResolvedValue(
    crowd({ singers: 11, comfortable_share: 0.7273, too_high_share: 0.1818, too_low_share: 0.0909, bucket: 'tenor' }),
  );
  renderTonight(<SongCrowdLine songKey={KEY} />);
  expect(await screen.findByTestId('song-crowd')).toHaveTextContent('8 of 11 singers found the key comfortable');
});

it('an unknown bucket name falls back to the overall figure', async () => {
  api.getSongCrowd.mockResolvedValue(
    crowd({ singers: 5, comfortable_share: 0.6, bucket: 'countertenor', bucket_singers: 5, bucket_comfortable_share: 1 }),
  );
  renderTonight(<SongCrowdLine songKey={KEY} />);
  expect(await screen.findByTestId('song-crowd')).toHaveTextContent('3 of 5 singers found the key comfortable');
});

it('when most singers found it too high (>= 0.6): "Most singers found it a bit high"', async () => {
  api.getSongCrowd.mockResolvedValue(crowd({ singers: 10, comfortable_share: 0.3, too_high_share: 0.6, too_low_share: 0.1 }));
  renderTonight(<SongCrowdLine songKey={KEY} />);
  expect(await screen.findByTestId('song-crowd')).toHaveTextContent('Most singers found it a bit high');
});

it('just under 0.6 too high still shows the overall figure', async () => {
  api.getSongCrowd.mockResolvedValue(crowd({ singers: 10, comfortable_share: 0.41, too_high_share: 0.59 }));
  renderTonight(<SongCrowdLine songKey={KEY} />);
  expect(await screen.findByTestId('song-crowd')).toHaveTextContent('4 of 10 singers found the key comfortable');
});

it('a bucket figure wins over "mostly too high"', async () => {
  api.getSongCrowd.mockResolvedValue(
    crowd({ singers: 10, comfortable_share: 0.3, too_high_share: 0.7, bucket: 'bass', bucket_singers: 5, bucket_comfortable_share: 0.8 }),
  );
  renderTonight(<SongCrowdLine songKey={KEY} />);
  expect(await screen.findByTestId('song-crowd')).toHaveTextContent('80% of basses found the key comfortable');
});

it('all nulls (below threshold) render nothing', async () => {
  api.getSongCrowd.mockResolvedValue(NULLS);
  renderTonight(<SongCrowdLine songKey={KEY} />);
  await waitFor(() => expect(api.getSongCrowd).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.queryByTestId('song-crowd')).toBeNull();
});

it('only a crowd-pleaser share (no key figure) renders nothing', async () => {
  api.getSongCrowd.mockResolvedValue(crowd({ crowd_pleaser_share: 0.8 }));
  renderTonight(<SongCrowdLine songKey={KEY} />);
  await waitFor(() => expect(api.getSongCrowd).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.queryByTestId('song-crowd')).toBeNull();
});

it('a failed fetch renders nothing', async () => {
  api.getSongCrowd.mockRejectedValue(new Error('down'));
  renderTonight(<SongCrowdLine songKey={KEY} />);
  await waitFor(() => expect(api.getSongCrowd).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.queryByTestId('song-crowd')).toBeNull();
});

it('signed out: no fetch and nothing rendered', async () => {
  await act(async () => {
    await useAuth.getState().signOut();
  });
  renderTonight(<SongCrowdLine songKey={KEY} />);
  await act(async () => {});
  expect(api.getSongCrowd).not.toHaveBeenCalled();
  expect(screen.queryByTestId('song-crowd')).toBeNull();
});

it('offline: keeps the last cached value without fetching, or shows nothing', async () => {
  api.getSongCrowd.mockResolvedValue(crowd({ singers: 11, comfortable_share: 0.7273 }));
  const first = renderTonight(<SongCrowdLine songKey={KEY} />);
  expect(await screen.findByTestId('song-crowd')).toHaveTextContent(/8 of 11 singers/);

  mockConnected = false;
  first.rerender(<SongCrowdLine songKey={KEY} />);
  expect(screen.getByTestId('song-crowd')).toHaveTextContent(/8 of 11 singers/);
  expect(api.getSongCrowd).toHaveBeenCalledTimes(1);

  // Another song with nothing cached: no fetch while offline, nothing shown.
  first.rerender(<SongCrowdLine songKey="other band|other song" />);
  await act(async () => {});
  expect(api.getSongCrowd).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('song-crowd')).toBeNull();
});
