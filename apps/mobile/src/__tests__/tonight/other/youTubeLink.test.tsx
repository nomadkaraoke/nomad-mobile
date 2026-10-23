import * as decide from '@nomad/api-decide';
import type { SongDetail, Version } from '@nomad/api-decide';
import * as gen from '@nomad/api-gen';
import type { JobSummary } from '@nomad/api-gen';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';

import { useLogStore } from '../../../tonight/log/logStore';
import { outboxIdle } from '../../../tonight/log/outbox';
import { OtherNightScreen } from '../../../tonight/other/OtherNightScreen';
import { renderTonight } from '../../../test-utils/tonightFixtures';
import { otherNight, signedInClean } from './setup';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  putKaraokeLog: jest.fn(),
  deleteKaraokeLog: jest.fn(),
  getSongDetail: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), listMyJobs: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const dapi = decide as jest.Mocked<typeof decide>;
const gapi = gen as jest.Mocked<typeof gen>;

const job = (over: Partial<JobSummary> & { youtube_url?: string }): JobSummary => {
  const { youtube_url, ...rest } = over;
  return { job_id: 'j1', status: 'complete', progress: 100, artist: 'Muse', title: 'Starlight', state_data: youtube_url ? { youtube_url } : {}, ...rest } as JobSummary;
};
const v = (kind: Version['kind'], youtube_url: string | null): Version => ({ brand_code: 'B', brand_name: 'B', kind, youtube_url, rank: 0 });

describe('youtube link only when one exists (rows)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    signedInClean();
    dapi.putKaraokeLog.mockResolvedValue({ id: 'x', user_id: 'u', source: 'app' });
    gapi.listMyJobs.mockResolvedValue([]);
  });
  afterEach(async () => {
    await outboxIdle();
  });

  it('hides Copy / Share when there is no link', async () => {
    const night = otherNight();
    const id = useLogStore.getState().addOther({ artist: 'Local Band', title: 'Our Song' }, 'planned')!;
    renderTonight(<OtherNightScreen night={night} />);
    expect(screen.getByTestId(`other-row-${id}`)).toBeTruthy();
    await waitFor(() => expect(gapi.listMyJobs).toHaveBeenCalled());
    expect(screen.queryByTestId(`other-row-${id}-copy-yt`)).toBeNull();
    expect(screen.queryByTestId(`other-row-${id}-share-yt`)).toBeNull();
    expect(dapi.getSongDetail).not.toHaveBeenCalled(); // no song_key: nothing to look up
  });

  it('shows Copy / Share for a community version and copies / shares the link', async () => {
    const detail: SongDetail = { song: { artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight', karaoke: true }, versions: [v('community', 'https://youtu.be/comm0000000')] };
    dapi.getSongDetail.mockResolvedValue(detail);
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const night = otherNight();
    const id = useLogStore.getState().addOther({ artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight' }, 'requested')!;
    renderTonight(<OtherNightScreen night={night} />);
    fireEvent.press(await screen.findByTestId(`other-row-${id}-copy-yt`));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://youtu.be/comm0000000');
    expect(await screen.findByText('Copied')).toBeTruthy();
    fireEvent.press(screen.getByTestId(`other-row-${id}-share-yt`));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('https://youtu.be/comm0000000') }));
  });

  it('uses the user\'s own gen video when there is one', async () => {
    gapi.listMyJobs.mockResolvedValue([job({ youtube_url: 'https://youtu.be/mine0000000' })]);
    const night = otherNight();
    const id = useLogStore.getState().addOther({ artist: 'Muse', title: 'Starlight' }, 'planned')!;
    renderTonight(<OtherNightScreen night={night} />);
    fireEvent.press(await screen.findByTestId(`other-row-${id}-copy-yt`));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://youtu.be/mine0000000');
  });
});
