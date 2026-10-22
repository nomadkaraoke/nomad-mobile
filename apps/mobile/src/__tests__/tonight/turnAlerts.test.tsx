import * as kjbox from '@nomad/api-kjbox';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '../../auth/store';
import { appStorage } from '../../storage';
import { useNightStore, type NomadNight } from '../../tonight/nightStore';
import { NightScreen } from '../../tonight/nomad/NightScreen';
import { nightPoll } from '../../tonight/nomad/queries';
import { turnAlertTiming, turnOf, useTurnAlerts } from '../../tonight/nomad/useTurnAlerts';
import { at, me, nightOpen, nowResult, renderTonight, rotationResult, song } from '../../test-utils/tonightFixtures';

jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getMe: jest.fn(),
  getNow: jest.fn(),
  getRotation: jest.fn(),
  getNight: jest.fn(),
}));
const api = kjbox as jest.Mocked<typeof kjbox>;
const haptic = Haptics.notificationAsync as jest.Mock;
const NIGHT = 'aaaaaaaaaaaaaaaa';

const next = (position: number, entryId = 501) => ({ entry_id: entryId, position, eta_s: 0, range_low_s: 0, range_high_s: 0 });
const mine = (entryId = 501, title = 'Starlight', estimate = at(1)) =>
  song({ request: { song_title: title, linked_entry_id: entryId }, estimate });

// react-native's jest setup mocks AppState.addEventListener; its calls hold the listeners.
const emit = (s: AppStateStatus) =>
  act(() => {
    (AppState as { currentState: AppStateStatus }).currentState = s;
    (AppState.addEventListener as jest.Mock).mock.calls
      .filter(([type]) => type === 'change')
      .forEach(([, fn]) => (fn as (x: AppStateStatus) => void)(s));
  });

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  appStorage.clearAll();
  (AppState as { currentState: AppStateStatus }).currentState = 'active';
  turnAlertTiming.bannerMs = 10_000;
});

type Props = { m: kjbox.MeResult | undefined; at?: number };
/** `at` = the query's dataUpdatedAt (default: just received). */
const hook = (initial: kjbox.MeResult | undefined, userKey = 'u1', nightId = NIGHT, at?: number) =>
  renderHook(({ m, at: when }: Props) => useTurnAlerts(m, when ?? Date.now(), userKey, nightId), { initialProps: { m: initial, at } as Props });

describe('useTurnAlerts', () => {
  it('alerts fire once per transition (up next, then on stage), never again for the same entry and state', () => {
    const { result, rerender } = hook(me({ songs: [mine(501, 'Starlight', at(3))], next: next(3) }));
    expect(haptic).not.toHaveBeenCalled();
    expect(result.current.alert).toBeNull();

    rerender({ m: me({ songs: [mine(501, 'Starlight', at(1))], next: next(1) }) });
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    expect(result.current.alert).toEqual({ state: 'up_next', title: 'Starlight', artist: 'Muse' });

    // Polls with the same state: no repeat.
    rerender({ m: me({ songs: [mine(501, 'Starlight', at(1))], next: next(1) }) });
    expect(haptic).toHaveBeenCalledTimes(1);

    rerender({ m: me({ songs: [mine(501, 'Starlight', at(1, 0, true))], next: null }) });
    expect(haptic).toHaveBeenCalledTimes(2);
    expect(result.current.alert?.state).toBe('now_singing');

    // Back to "up next" for the same entry (a host shuffle) doesn't alert twice.
    rerender({ m: me({ songs: [mine(501, 'Starlight', at(1))], next: next(1) }) });
    expect(haptic).toHaveBeenCalledTimes(2);

    // The next song (another entry) alerts again.
    rerender({ m: me({ songs: [mine(777, 'Uprising', at(1))], next: next(1, 777) }) });
    expect(haptic).toHaveBeenCalledTimes(3);
  });

  it('no alert when backgrounded; on return only fresh /me data alerts, never the stale cache', () => {
    (AppState as { currentState: AppStateStatus }).currentState = 'background';
    const m = me({ songs: [mine()], next: next(1) });
    const stale = Date.now() - 60_000;
    const { result, rerender } = hook(m, 'u1', NIGHT, stale);
    expect(haptic).not.toHaveBeenCalled();
    expect(result.current.alert).toBeNull();
    emit('active');
    // The cached /me is from before the return: no buzz.
    expect(haptic).not.toHaveBeenCalled();
    expect(result.current.alert).toBeNull();
    // The refetch on return lands: the turn still holds, so it alerts.
    rerender({ m, at: Date.now() + 1 });
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(result.current.alert?.state).toBe('up_next');
  });

  it('a turn in data fetched before backgrounding does not alert after the return', () => {
    const { rerender } = hook(me({ songs: [mine(501, 'Starlight', at(3))], next: next(3) }), 'u1', NIGHT, Date.now());
    const before = Date.now();
    emit('background');
    emit('active');
    // Same old dataUpdatedAt, but now showing up next (e.g. a re-render with older cached data).
    rerender({ m: me({ songs: [mine()], next: next(1) }), at: before - 1 });
    expect(haptic).not.toHaveBeenCalled();
  });

  it('the fired set survives a restart, per user and night (ruling E10-R3)', () => {
    const m = me({ songs: [mine()], next: next(1) });
    hook(m).unmount();
    expect(haptic).toHaveBeenCalledTimes(1);
    hook(m).unmount();
    expect(haptic).toHaveBeenCalledTimes(1);
    hook(m, 'u2').unmount();
    expect(haptic).toHaveBeenCalledTimes(2);
    hook(m, 'u1', 'bbbbbbbbbbbbbbbb').unmount();
    expect(haptic).toHaveBeenCalledTimes(3);
  });

  it('place 2 while someone is on stage is "up next" (the box\'s Up Next), not while the stage is empty', () => {
    const at2 = me({ songs: [mine(501, 'Starlight', at(2))], next: next(2) });
    expect(turnOf(at2)).toBeNull();
    expect(turnOf(at2, true)?.state).toBe('up_next');
    const { result } = renderHook(() => useTurnAlerts(at2, Date.now(), 'u1', NIGHT, true));
    expect(result.current.alert?.state).toBe('up_next');
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it("a friend's song on stage is not the singer's turn", () => {
    const friend = song({ owner: 'friend', request: { linked_entry_id: 9, for_friend: true }, estimate: at(1, 0, true) });
    expect(turnOf(me({ songs: [friend] }))).toBeNull();
    hook(me({ songs: [friend] }));
    expect(haptic).not.toHaveBeenCalled();
  });

  it('the banner hides after its time', async () => {
    turnAlertTiming.bannerMs = 30;
    const { result } = hook(me({ songs: [mine()], next: next(1) }));
    expect(result.current.alert).not.toBeNull();
    await waitFor(() => expect(result.current.alert === null).toBe(true));
  });

  it('a haptics failure never breaks the alert', () => {
    haptic.mockRejectedValueOnce(new Error('no engine'));
    const { result } = hook(me({ songs: [mine()], next: next(1) }));
    expect(result.current.alert?.state).toBe('up_next');
  });
});

describe('night screen banner', () => {
  let night: NomadNight;
  beforeEach(() => {
    Object.assign(nightPoll, { meMs: 60_000, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000 });
    useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email: 'sam@example.com', createdAt: 0 } } });
    useNightStore.getState().rehydrate('sam@example.com');
    useNightStore.getState().joinNomad('2121', NIGHT, 'Sam');
    night = useNightStore.getState().current() as NomadNight;
    api.getNow.mockResolvedValue(nowResult());
    api.getRotation.mockResolvedValue({ etag: '"1"', data: rotationResult([]) });
    api.getNight.mockResolvedValue(nightOpen({ night_id: NIGHT }));
  });

  it('shows "up next" with the song, and dismisses', async () => {
    api.getMe.mockResolvedValue(me({ songs: [mine()], next: next(1) }));
    renderTonight(<NightScreen night={night} focused />);
    expect(await screen.findByTestId('tonight-turn-banner')).toBeTruthy();
    expect(screen.getByTestId('tonight-turn-banner-text')).toHaveTextContent(/You're up next: .*Starlight.* by .*Muse.*\. Get ready!/);
    fireEvent.press(screen.getByTestId('tonight-turn-banner-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('tonight-turn-banner') === null).toBe(true));
  });

  it('no banner while further back in line', async () => {
    api.getMe.mockResolvedValue(me({ songs: [mine(501, 'Starlight', at(4))], next: next(4) }));
    renderTonight(<NightScreen night={night} focused />);
    expect(await screen.findByTestId('tonight-status-tile')).toBeTruthy();
    expect(screen.queryByTestId('tonight-turn-banner')).toBeNull();
    expect(haptic).not.toHaveBeenCalled();
  });
});
