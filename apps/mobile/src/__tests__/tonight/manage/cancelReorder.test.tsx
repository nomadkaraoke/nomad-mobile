import * as kjbox from '@nomad/api-kjbox';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { NomadNight } from '../../../tonight/nightStore';
import { useEditingStore } from '../../../tonight/nomad/editingStore';
import { reorderable } from '../../../tonight/manage/ReorderList';
import { at, me, song } from '../../../test-utils/tonightFixtures';
import { requestResult, restoreTiming, setupNight, showNight, sleep } from './setup';

jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getMe: jest.fn(),
  getNow: jest.fn(),
  getRotation: jest.fn(),
  getNight: jest.fn(),
  cancelRequest: jest.fn(),
  reorder: jest.fn(),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');

let night: NomadNight;
beforeEach(() => {
  night = setupNight(api);
});
afterAll(restoreTiming);

describe('cancel (A.53, A.56, ruling E6-R2)', () => {
  it('is instant: the row hides at once and a 15 s "Cancelled: X" notice shows, then goes', async () => {
    api.getMe.mockResolvedValue(me({ songs: [song({ request: { id: 7, song_title: 'Starlight' }, estimate: at(4) })] }));
    let resolve!: (v: kjbox.RequestResult) => void;
    api.cancelRequest.mockReturnValue(new Promise((r) => (resolve = r)));
    showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-song-cancel-r7'));
    // Hidden before the box has even answered.
    await waitFor(() => expect(screen.queryByTestId('tonight-song-r7') === null).toBe(true));
    expect(api.cancelRequest).toHaveBeenCalledWith('2121', 7, night.nightId);
    api.getMe.mockResolvedValue(me({ songs: [] }));
    resolve(requestResult({ id: 7, status: 'cancelled' }));
    expect(await screen.findByTestId('tonight-notice')).toHaveTextContent('Cancelled: ⁨Starlight⁩');
    // Time-boxed (manageTiming.noticeMs, 15 s in the app).
    await waitFor(() => expect(screen.queryByTestId('tonight-notice') === null).toBe(true), { timeout: 2000 });
    expect(screen.queryByTestId('tonight-song-r7')).toBeNull();
  });

  it('cancel and change are not offered while the singer is on stage', async () => {
    api.getMe.mockResolvedValue(
      me({ songs: [song({ request: { id: 7 }, estimate: at(1, 0, true) }), song({ request: { id: 8 }, estimate: at(5) })] }),
    );
    showNight(night);
    expect(await screen.findByTestId('tonight-song-r7')).toBeTruthy();
    expect(screen.queryByTestId('tonight-song-cancel-r7')).toBeNull();
    expect(screen.queryByTestId('tonight-song-change-r7')).toBeNull();
    expect(screen.getByTestId('tonight-song-cancel-r8')).toBeTruthy();
  });

  it('409 already_sung brings the row back with the copy and refreshes /me', async () => {
    api.getMe.mockResolvedValue(me({ songs: [song({ request: { id: 7 }, estimate: at(4) })] }));
    api.cancelRequest.mockRejectedValue(new KjboxError('already_sung', 409, undefined, { error: 'already_sung' }));
    showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-song-cancel-r7'));
    expect(await screen.findByText('That song has already been sung tonight.')).toBeTruthy();
    expect(screen.getByTestId('tonight-song-r7')).toBeTruthy();
    await waitFor(() => expect(api.getMe.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

describe('reorder (A.57, ruling E6-R3)', () => {
  const songs = () => [
    song({ request: { id: 1, song_title: 'One' }, estimate: at(3) }),
    song({ owner: 'host', request: { id: null, song_title: 'Two - Band', source_type: 'rotation', linked_entry_id: null }, entry_id: 77, estimate: at(6) }),
    song({ request: { id: 3, song_title: 'Three' }, estimate: at(9) }),
    // Not movable: pending (no queue position).
    song({ request: { id: 4, song_title: 'Four', status: 'pending', linked_entry_id: null } }),
  ];

  it('only own approved songs (by id) and host/partner entries (by entry_id) with a queue position can move', () => {
    expect(reorderable(songs()).map((r) => r.item)).toEqual([{ id: 1 }, { entry_id: 77 }, { id: 3 }]);
  });

  it('▲/▼ with row numbers; polling pauses while editing; one reorder call; "✓ New order saved"', async () => {
    api.getMe.mockResolvedValue(me({ songs: songs() }));
    api.reorder.mockResolvedValue(requestResult({ source_type: 'reorder' }));
    showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-reorder'));
    expect(await screen.findByTestId('tonight-reorder-number-r1')).toHaveTextContent('1.');
    expect(screen.getByTestId('tonight-reorder-number-e77')).toHaveTextContent('2.');
    expect(screen.getByTestId('tonight-reorder-number-r3')).toHaveTextContent('3.');
    expect(screen.queryByTestId('tonight-reorder-row-r4')).toBeNull();
    // Editing pauses the night's polls (usePollingActive).
    expect(useEditingStore.getState().editing).toBe(true);
    expect(screen.getByTestId('tonight-reorder-up-r1')).toBeDisabled();

    fireEvent.press(screen.getByTestId('tonight-reorder-down-r1'));
    fireEvent.press(screen.getByTestId('tonight-reorder-up-r3'));
    expect(screen.getByTestId('tonight-reorder-number-r3')).toHaveTextContent('2.');
    expect(api.reorder).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('tonight-reorder-save'));
    fireEvent.press(screen.getByTestId('tonight-reorder-save'));
    expect(await screen.findByTestId('tonight-notice')).toHaveTextContent('✓ New order saved');
    expect(api.reorder).toHaveBeenCalledTimes(1);
    expect(api.reorder).toHaveBeenCalledWith('2121', [{ entry_id: 77 }, { id: 3 }, { id: 1 }], night.nightId);
    expect(useEditingStore.getState().editing).toBe(false);
    expect(screen.queryByTestId('tonight-reorder')).toBeTruthy(); // the button is back
    expect(screen.queryByTestId('tonight-reorder-save')).toBeNull();
  });

  it('cancelling reorder sends nothing and resumes polling', async () => {
    api.getMe.mockResolvedValue(me({ songs: songs() }));
    showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-reorder'));
    fireEvent.press(await screen.findByTestId('tonight-reorder-down-r1'));
    fireEvent.press(screen.getByTestId('tonight-reorder-cancel'));
    await sleep(10);
    expect(api.reorder).not.toHaveBeenCalled();
    expect(useEditingStore.getState().editing).toBe(false);
  });
});

describe('reorder survives a /me refresh mid-edit (fix round 1)', () => {
  const base = () => [
    song({ request: { id: 1, song_title: 'One' }, estimate: at(3) }),
    song({ request: { id: 2, song_title: 'Two' }, estimate: at(6) }),
    song({ request: { id: 3, song_title: 'Three' }, estimate: at(9) }),
  ];

  it('rows that left drop out, new ones are appended, save sends only current rows; refresh is disabled', async () => {
    api.getMe.mockResolvedValue(me({ songs: base() }));
    api.reorder.mockResolvedValue(requestResult({ source_type: 'reorder' }));
    const { client } = showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-reorder'));
    fireEvent.press(await screen.findByTestId('tonight-reorder-down-r1'));
    expect(screen.getByTestId('tonight-refresh')).toBeDisabled();

    // r2 was sung meanwhile; r5 arrived.
    api.getMe.mockResolvedValue(
      me({
        songs: [
          song({ request: { id: 1, song_title: 'One' }, estimate: at(3) }),
          song({ request: { id: 3, song_title: 'Three' }, estimate: at(9) }),
          song({ request: { id: 5, song_title: 'Five' }, estimate: at(12) }),
        ],
      }),
    );
    await act(() => client.refetchQueries());
    await waitFor(() => expect(screen.queryByTestId('tonight-reorder-row-r2') === null).toBe(true));
    // The singer's move (r1 below r2) is kept for the rows still here: r1, r3, then the new r5.
    expect(screen.getByTestId('tonight-reorder-number-r1')).toHaveTextContent('1.');
    expect(screen.getByTestId('tonight-reorder-number-r3')).toHaveTextContent('2.');
    expect(screen.getByTestId('tonight-reorder-number-r5')).toHaveTextContent('3.');
    fireEvent.press(screen.getByTestId('tonight-reorder-up-r5'));
    fireEvent.press(screen.getByTestId('tonight-reorder-save'));
    await waitFor(() => expect(api.reorder).toHaveBeenCalledWith('2121', [{ id: 1 }, { id: 5 }, { id: 3 }], night.nightId));
  });

  it('reorder excludes on-stage and friend rows', () => {
    const rows = [
      song({ request: { id: 1 }, estimate: at(1, 0, true) }),
      song({ owner: 'friend', request: { id: 2, for_friend: true }, estimate: at(4) }),
      song({ request: { id: 3 }, estimate: at(6) }),
    ];
    expect(reorderable(rows).map((r) => r.item)).toEqual([{ id: 3 }]);
  });
});
