import * as decide from '@nomad/api-decide';
import * as gen from '@nomad/api-gen';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../../auth/store';
import { setLogClock, useLogStore } from '../../../tonight/log/logStore';
import { outboxIdle, useOutbox } from '../../../tonight/log/outbox';
import { setNightClock, useNightStore } from '../../../tonight/nightStore';
import { OtherNightScreen } from '../../../tonight/other/OtherNightScreen';
import { makeRoutes } from '../../../test-utils/makeFixtures';
import { renderTonight } from '../../../test-utils/tonightFixtures';
import { otherNight, signedInClean } from './setup';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  putKaraokeLog: jest.fn(),
  deleteKaraokeLog: jest.fn(),
  listKaraokeLog: jest.fn(),
  getSongDetail: jest.fn(),
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), listMyJobs: jest.fn(), getMe: jest.fn() }));

const dapi = decide as jest.Mocked<typeof decide>;
const gapi = gen as jest.Mocked<typeof gen>;

let now = Date.UTC(2026, 9, 21, 20, 0, 0);
const tick = (ms = 1000) => (now += ms);

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  now = Date.UTC(2026, 9, 21, 20, 0, 0);
  setLogClock(() => now);
  signedInClean();
  setNightClock(() => now);
  dapi.putKaraokeLog.mockResolvedValue({ id: 'x', user_id: 'u', source: 'app' });
  dapi.deleteKaraokeLog.mockResolvedValue({ id: 'x', user_id: 'u', source: 'app' });
  dapi.listKaraokeLog.mockResolvedValue({ entries: [], next_cursor: null });
  dapi.getSongDetail.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
  gapi.listMyJobs.mockResolvedValue([]);
  gapi.getMe.mockResolvedValue({ email: 'sam@example.com', credits: 1 } as never);
});

afterEach(async () => {
  await outboxIdle();
  setLogClock();
  setNightClock();
});

const add = (title: string, state: 'planned' | 'requested' | 'sung', song_key?: string) => {
  tick();
  return useLogStore.getState().addOther({ artist: 'Muse', title, ...(song_key ? { song_key } : {}) }, state)!;
};

const titlesIn = (group: string) =>
  within(screen.getByTestId(`other-group-${group}`))
    .queryAllByTestId(/^other-row-title-/)
    .map((n) => n.props.children as string);

it('other night groups: Sung / Up next / Maybe, each newest first, only tonight\'s entries', async () => {
  const night = otherNight();
  add('Old planned', 'planned');
  add('Requested A', 'requested');
  add('Sung A', 'sung');
  add('New planned', 'planned');
  add('Requested B', 'requested');
  add('Sung B', 'sung');
  // A song from another night never shows.
  useLogStore.setState((s) => ({
    entries: { ...s.entries, app_other: { id: 'app_other', source: 'app', state: 'sung', artist: 'X', title: 'Last week', updatedAt: 1, night: { id: 'other-night', kind: 'other' } } },
  }));
  renderTonight(<OtherNightScreen night={night} />);
  expect(screen.getByTestId('other-venue').props.value).toBe('The Crown');
  expect(titlesIn('sung')).toEqual(['Sung B', 'Sung A']);
  expect(titlesIn('requested')).toEqual(['Requested B', 'Requested A']);
  expect(titlesIn('planned')).toEqual(['New planned', 'Old planned']);
  expect(screen.queryByText('Last week')).toBeNull();
});

it('an empty night shows a hint and no groups', () => {
  const night = otherNight();
  renderTonight(<OtherNightScreen night={night} />);
  expect(screen.getByTestId('other-empty')).toBeTruthy();
  expect(screen.queryByTestId('other-group-sung')).toBeNull();
});

describe('row actions go through logStore + outbox and touch the night (E9-R3)', () => {
  it('"I\'ve requested it" moves a Maybe to Up next, sends {state}, and keeps the night alive', async () => {
    const night = otherNight();
    const id = add('Starlight', 'planned');
    await outboxIdle();
    dapi.putKaraokeLog.mockClear();
    tick(60 * 60 * 1000);
    renderTonight(<OtherNightScreen night={night} />);
    fireEvent.press(screen.getByTestId(`other-row-${id}-requested`));
    expect(titlesIn('requested')).toEqual(['Starlight']);
    expect(screen.queryByTestId('other-group-planned')).toBeNull();
    await waitFor(() => expect(dapi.putKaraokeLog).toHaveBeenCalledWith(id, { state: 'requested' }));
    expect((useNightStore.getState().active as { lastActivityAt: number }).lastActivityAt).toBe(now);
  });

  it('"Maybe later" moves Up next back to Maybe', async () => {
    const night = otherNight();
    const id = add('Starlight', 'requested');
    await outboxIdle();
    renderTonight(<OtherNightScreen night={night} />);
    fireEvent.press(screen.getByTestId(`other-row-${id}-planned`));
    expect(titlesIn('planned')).toEqual(['Starlight']);
    await waitFor(() => expect(dapi.putKaraokeLog).toHaveBeenLastCalledWith(id, { state: 'planned' }));
  });

  it('remove deletes the entry locally and through the outbox', async () => {
    const night = otherNight();
    const id = add('Starlight', 'planned');
    renderTonight(<OtherNightScreen night={night} />);
    fireEvent.press(screen.getByTestId(`other-row-${id}-remove`));
    await waitFor(() => expect(screen.queryByTestId(`other-row-${id}`)).toBeNull());
    await waitFor(() => expect(dapi.deleteKaraokeLog).toHaveBeenCalledWith(id));
  });
});

it('sang it opens survey; saving sends {survey} only; "How did it go?" reopens it prefilled', async () => {
  const night = otherNight();
  const id = add('Starlight', 'requested');
  renderTonight(<OtherNightScreen night={night} />);
  expect(screen.queryByTestId('survey')).toBeNull();
  fireEvent.press(screen.getByTestId(`other-row-${id}-sung`));
  expect(titlesIn('sung')).toEqual(['Starlight']);
  expect(await screen.findByTestId('survey')).toBeTruthy();
  fireEvent.press(screen.getByTestId('survey-key-too_high'));
  fireEvent.press(screen.getByTestId('survey-save'));
  await waitFor(() => expect(screen.queryByTestId('survey')).toBeNull());
  await outboxIdle();
  expect(dapi.putKaraokeLog).toHaveBeenCalledWith(id, expect.objectContaining({ survey: expect.objectContaining({ key: 'too_high' }) }));
  expect(useLogStore.getState().entries[id]?.state).toBe('sung');
  // Reopen from the sung row.
  fireEvent.press(screen.getByTestId(`other-row-${id}-survey`));
  expect(await screen.findByTestId('survey')).toBeTruthy();
  expect(screen.getByTestId('survey-key-too_high').props.accessibilityState.selected).toBe(true);
});

it('the venue name is editable', () => {
  const night = otherNight();
  renderTonight(<OtherNightScreen night={night} />);
  fireEvent.changeText(screen.getByTestId('other-venue'), 'The Anchor');
  expect((useNightStore.getState().active as { venueName?: string }).venueName).toBe('The Anchor');
});

it('End night asks first, says the songs stay saved, and Cancel keeps the night', async () => {
  const night = otherNight();
  renderTonight(<OtherNightScreen night={night} />);
  fireEvent.press(screen.getByTestId('other-end'));
  expect(await screen.findByTestId('other-end-sheet')).toBeTruthy();
  expect(screen.getByText("Tonight's songs stay saved in your karaoke log.")).toBeTruthy();
  expect(useNightStore.getState().active).not.toBeNull();
  fireEvent.press(screen.getByTestId('other-end-cancel'));
  await waitFor(() => expect(screen.queryByTestId('other-end-sheet')).toBeNull());
  expect(useNightStore.getState().active).not.toBeNull();
  fireEvent.press(screen.getByTestId('other-end'));
  fireEvent.press(await screen.findByTestId('other-end-confirm'));
  expect(useNightStore.getState().active).toBeNull();
});

it('queued outbox items and the local log survive end()', async () => {
  dapi.putKaraokeLog.mockRejectedValue(new TypeError('Network request failed'));
  otherNight();
  const id = add('Starlight', 'sung');
  await outboxIdle();
  useNightStore.getState().end();
  expect(useNightStore.getState().active).toBeNull();
  expect(useOutbox.getState().items.map((i) => i.id)).toEqual([id]);
  expect(useLogStore.getState().entries[id]?.title).toBe('Starlight');
  dapi.putKaraokeLog.mockResolvedValue({ id, user_id: 'u', source: 'app' });
  await useOutbox.getState().flush();
  await outboxIdle();
  expect(useOutbox.getState().items).toEqual([]);
});

it('saving a survey from the Other screen touches the night', async () => {
  const night = otherNight();
  const id = add('Starlight', 'sung');
  renderTonight(<OtherNightScreen night={night} />);
  tick(2 * 60 * 60 * 1000);
  fireEvent.press(screen.getByTestId(`other-row-${id}-survey`));
  fireEvent.press(await screen.findByTestId('survey-feel-great'));
  fireEvent.press(screen.getByTestId('survey-save'));
  await waitFor(() => expect(screen.queryByTestId('survey')).toBeNull());
  expect((useNightStore.getState().active as { lastActivityAt: number }).lastActivityAt).toBe(now);
});

describe('Tonight tab (E9-R2)', () => {
  // The router's root layout hydrates the session from SecureStore: persist it there.
  beforeEach(async () => {
    await useAuth.getState().signInWithSession({ token: 't', email: 'sam@example.com', createdAt: 0 } as never);
  });

  it('"Start logging tonight" asks for an optional venue, then shows the Other night screen', async () => {
    renderRouter(makeRoutes(), { initialUrl: '/tonight' });
    fireEvent.press(await screen.findByTestId('tonight-start-other'));
    fireEvent.changeText(await screen.findByTestId('tonight-venue-input'), '  The Crown ');
    fireEvent.press(screen.getByTestId('tonight-start-other-confirm'));
    expect(await screen.findByTestId('other-night-screen')).toBeTruthy();
    const active = useNightStore.getState().active;
    expect(active?.kind).toBe('other');
    expect((active as { venueName?: string }).venueName).toBe('The Crown');
  });

  it('the venue is optional', async () => {
    renderRouter(makeRoutes(), { initialUrl: '/tonight' });
    fireEvent.press(await screen.findByTestId('tonight-start-other'));
    fireEvent.press(await screen.findByTestId('tonight-start-other-confirm'));
    expect(await screen.findByTestId('other-night-screen')).toBeTruthy();
    expect((useNightStore.getState().active as { venueName?: string }).venueName).toBeUndefined();
  });

  it('an active Other night shows its screen on the tab', async () => {
    otherNight();
    renderRouter(makeRoutes(), { initialUrl: '/tonight' });
    expect(await screen.findByTestId('other-night-screen')).toBeTruthy();
    await act(async () => {});
    expect(useOutbox.getState().items).toEqual([]);
  });
});
