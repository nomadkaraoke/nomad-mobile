import * as decide from '@nomad/api-decide';
import * as kjbox from '@nomad/api-kjbox';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useAuth } from '../../../auth/store';
import { appStorage } from '../../../storage';
import { useLogStore } from '../../../tonight/log/logStore';
import { outboxIdle, useOutbox } from '../../../tonight/log/outbox';
import { SurveySheet } from '../../../tonight/log/SurveySheet';
import { VersionInfoSheet } from '../../../tonight/request/VersionInfoSheet';
import { useNightStore, type NomadNight } from '../../../tonight/nightStore';
import { useEditingStore } from '../../../tonight/nomad/editingStore';
import { NightScreen } from '../../../tonight/nomad/NightScreen';
import { nightPoll } from '../../../tonight/nomad/queries';
import { me, nightOpen, nowResult, renderTonight, rotationResult, song } from '../../../test-utils/tonightFixtures';

jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getMe: jest.fn(),
  getNow: jest.fn(),
  getRotation: jest.fn(),
  getNight: jest.fn(),
}));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  putKaraokeLog: jest.fn(),
  deleteKaraokeLog: jest.fn(),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const dapi = decide as jest.Mocked<typeof decide>;
const NIGHT_ID = 'aaaaaaaaaaaaaaaa';
const KJ1 = 'kj_111111111111111111111111';
const KJ2 = 'kj_222222222222222222222222';
const DEFAULT_POLL = { ...nightPoll, backoffMs: [...nightPoll.backoffMs] };
const sung = (title: string, history_id: string | null, over: Parameters<typeof song>[0] = {}) =>
  song({ performed: true, history_id, ...over, request: { song_title: title, ...over.request } });

let night: NomadNight;

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  appStorage.clearAll();
  useEditingStore.setState({ editing: false, sheets: 0 });
  Object.assign(nightPoll, { meMs: 40, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000, closedMs: 60_000, backoffMs: [60_000] });
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email: 'sam@example.com', createdAt: 0 } } });
  useNightStore.getState().rehydrate('sam@example.com');
  useLogStore.getState().rehydrate('sam@example.com');
  useOutbox.getState().rehydrate('sam@example.com');
  useNightStore.getState().joinNomad('2121', NIGHT_ID, 'Andrew');
  night = useNightStore.getState().current() as NomadNight;
  api.getMe.mockResolvedValue(me());
  api.getNow.mockResolvedValue(nowResult());
  api.getRotation.mockResolvedValue({ etag: '"7"', data: rotationResult([]) });
  api.getNight.mockResolvedValue(nightOpen());
  dapi.putKaraokeLog.mockResolvedValue({ id: 'x', user_id: 'u', source: 'kjbox' });
});

afterEach(async () => {
  await outboxIdle();
});
afterAll(() => Object.assign(nightPoll, DEFAULT_POLL));

const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

it('survey opens once per newly sung song', async () => {
  const view = renderTonight(<NightScreen night={night} focused />);
  await screen.findByTestId('tonight-freshness');
  expect(screen.queryByTestId('survey')).toBeNull();

  // The host marks Starlight Done: /me now lists it with a history_id.
  api.getMe.mockResolvedValue(me({ sung_tonight: [sung('Starlight', KJ1, { request: { song_artist: 'Muse' } })] }));
  expect(await screen.findByTestId('survey')).toBeTruthy();
  expect(screen.getByText(/Starlight/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('survey-skip')); // dismiss = skip
  await waitFor(() => expect(screen.queryByTestId('survey') === null).toBe(true));

  // Several more polls of the same /me: it never reopens.
  await sleep(150);
  expect(screen.queryByTestId('survey')).toBeNull();
  expect(useLogStore.getState().surveyed[KJ1]).toEqual(expect.any(Number));

  // A friend's song (no history_id) never opens it; the next sung song of their own does.
  api.getMe.mockResolvedValue(
    me({ sung_tonight: [sung('Starlight', KJ1), sung('Friend Song', null, { owner: 'friend' }), sung('Hello', KJ2)] }),
  );
  expect(await screen.findByTestId('survey')).toBeTruthy();
  expect(screen.getByText(/Hello/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('survey-feel-great'));
  fireEvent.press(screen.getByTestId('survey-save'));
  await waitFor(() => expect(screen.queryByTestId('survey') === null).toBe(true));
  await sleep(150);
  expect(screen.queryByTestId('survey')).toBeNull();
  await outboxIdle();
  expect(dapi.putKaraokeLog).toHaveBeenCalledWith(KJ2, { survey: { feel: 'great', answered_at: expect.any(String) } });

  // Next open of the app (a fresh screen): handled songs stay handled.
  view.unmount();
  renderTonight(<NightScreen night={night} focused />);
  await screen.findByTestId('tonight-freshness');
  await sleep(100);
  expect(screen.queryByTestId('survey')).toBeNull();
});

it('a song sung while the screen was away opens the survey on the next open', async () => {
  api.getMe.mockResolvedValue(me({ sung_tonight: [sung('Starlight', KJ1)] }));
  const view = renderTonight(<NightScreen night={night} focused={false} />);
  await screen.findByTestId('tonight-freshness');
  await sleep(60);
  expect(screen.queryByTestId('survey')).toBeNull();
  view.rerender(<NightScreen night={night} focused />);
  expect(await screen.findByTestId('survey')).toBeTruthy();
});

it('the survey sheet saves every answer', async () => {
  const onDone = jest.fn();
  renderTonight(<SurveySheet entryId="app_1" artist="Adele" title="Hello" onDone={onDone} />);
  fireEvent.press(screen.getByTestId('survey-feel-ok'));
  fireEvent.press(screen.getByTestId('survey-key-too_high'));
  fireEvent.press(screen.getByTestId('survey-crowd-no'));
  fireEvent.changeText(screen.getByTestId('survey-notes'), `  ${'x'.repeat(2100)}`);
  fireEvent.press(screen.getByTestId('survey-save'));
  expect(onDone).toHaveBeenCalled();
  await outboxIdle();
  const call = dapi.putKaraokeLog.mock.calls[0]!;
  expect(call[0]).toBe('app_1');
  expect(call[1]).toEqual({
    survey: { feel: 'ok', key: 'too_high', crowd_pleaser: false, notes: expect.any(String), answered_at: expect.any(String) },
  });
  expect(call[1].survey!.notes!.length).toBeLessThanOrEqual(2000);
});

it('SurveySheet vibe and why chips: reasons are hidden for great and shown for ok', () => {
  renderTonight(<SurveySheet entryId="app_v1" artist="Adele" title="Hello" />);
  expect(screen.getByTestId('survey-vibe-party')).toBeTruthy();
  expect(screen.queryByTestId('survey-reason-too_long')).toBeNull();
  fireEvent.press(screen.getByTestId('survey-feel-great'));
  expect(screen.queryByTestId('survey-reason-too_long')).toBeNull();
  fireEvent.press(screen.getByTestId('survey-feel-ok'));
  expect(screen.getByTestId('survey-reason-too_long')).toBeTruthy();
  fireEvent.press(screen.getByTestId('survey-feel-bad'));
  expect(screen.getByTestId('survey-reason-didnt_know_it')).toBeTruthy();
});

it('SurveySheet saves vibes and reasons through saveSurvey', async () => {
  renderTonight(<SurveySheet entryId="app_v2" artist="Adele" title="Hello" />);
  fireEvent.press(screen.getByTestId('survey-feel-ok'));
  fireEvent.press(screen.getByTestId('survey-vibe-ballad'));
  fireEvent.press(screen.getByTestId('survey-reason-too_long'));
  fireEvent.press(screen.getByTestId('survey-save'));
  await outboxIdle();
  expect(dapi.putKaraokeLog).toHaveBeenCalledWith('app_v2', {
    survey: { feel: 'ok', vibes: ['ballad'], reasons: ['too_long'], answered_at: expect.any(String) },
  });

});

it('SurveySheet vibes multi-select toggles, and reasons picked under ok are not sent once feel is great', async () => {
  renderTonight(<SurveySheet entryId="app_v3" artist="A" title="T" />);
  fireEvent.press(screen.getByTestId('survey-feel-ok'));
  fireEvent.press(screen.getByTestId('survey-reason-too_hard'));
  fireEvent.press(screen.getByTestId('survey-feel-great'));
  fireEvent.press(screen.getByTestId('survey-vibe-party'));
  fireEvent.press(screen.getByTestId('survey-vibe-duet'));
  fireEvent.press(screen.getByTestId('survey-vibe-party'));
  fireEvent.press(screen.getByTestId('survey-save'));
  await outboxIdle();
  expect(dapi.putKaraokeLog).toHaveBeenCalledWith('app_v3', {
    survey: { feel: 'great', vibes: ['duet'], answered_at: expect.any(String) },
  });
});

it('SurveySheet initial pre-selects vibes and reasons', () => {
  renderTonight(
    <SurveySheet entryId="app_v4" artist="A" title="T" initial={{ feel: 'bad', vibes: ['duet', 'party'], reasons: ['crowd_quiet'] }} />,
  );
  const sel = (id: string) => screen.getByTestId(id).props.accessibilityState;
  expect(sel('survey-vibe-duet')).toMatchObject({ selected: true });
  expect(sel('survey-vibe-party')).toMatchObject({ selected: true });
  expect(sel('survey-vibe-ballad')).toMatchObject({ selected: false });
  expect(sel('survey-reason-crowd_quiet')).toMatchObject({ selected: true });
  expect(sel('survey-reason-too_long')).toMatchObject({ selected: false });
});

it('SurveySheet an emptied vibe row is not stored or sent', async () => {
  renderTonight(<SurveySheet entryId="app_v5" artist="A" title="T" />);
  fireEvent.press(screen.getByTestId('survey-vibe-party'));
  fireEvent.press(screen.getByTestId('survey-vibe-party'));
  fireEvent.press(screen.getByTestId('survey-feel-great'));
  fireEvent.press(screen.getByTestId('survey-save'));
  await outboxIdle();
  expect(dapi.putKaraokeLog).toHaveBeenCalledWith('app_v5', { survey: { feel: 'great', answered_at: expect.any(String) } });
});

it('a second tap on a chosen answer clears it; closing the sheet skips', async () => {
  const onDone = jest.fn();
  renderTonight(<SurveySheet entryId="kj_q" artist="A" title="T" onDone={onDone} />);
  fireEvent.press(screen.getByTestId('survey-feel-great'));
  fireEvent.press(screen.getByTestId('survey-feel-great'));
  fireEvent.press(screen.getByTestId('survey-close'));
  expect(onDone).toHaveBeenCalled();
  expect(useLogStore.getState().surveyed.kj_q).toEqual(expect.any(Number));
  await outboxIdle();
  expect(dapi.putKaraokeLog).not.toHaveBeenCalled();
});

it('"How did it go?" on a sung row reopens the survey after a skip, and saves from it', async () => {
  api.getMe.mockResolvedValue(
    me({ sung_tonight: [sung('Starlight', KJ1, { request: { song_artist: 'Muse' } }), sung('Friend Song', null, { owner: 'friend' })] }),
  );
  renderTonight(<NightScreen night={night} focused />);
  fireEvent.press(await screen.findByTestId('survey-skip'));
  await waitFor(() => expect(screen.queryByTestId('survey') === null).toBe(true));

  fireEvent.press(screen.getByTestId('tonight-sung-toggle'));
  expect(screen.queryByTestId('sung-null-survey')).toBeNull(); // no history_id: no button
  fireEvent.press(screen.getByTestId(`sung-${KJ1}-survey`));
  expect(await screen.findByTestId('survey')).toBeTruthy();
  fireEvent.press(screen.getByTestId('survey-key-too_low'));
  fireEvent.press(screen.getByTestId('survey-save'));
  await waitFor(() => expect(screen.queryByTestId('survey') === null).toBe(true));
  await outboxIdle();
  expect(dapi.putKaraokeLog).toHaveBeenCalledWith(KJ1, { survey: { key: 'too_low', answered_at: expect.any(String) } });

  // Reopened again: starts from the saved answers.
  fireEvent.press(screen.getByTestId(`sung-${KJ1}-survey`));
  expect(await screen.findByTestId('survey')).toBeTruthy();
  expect(screen.getByTestId('survey-key-too_low').props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByTestId('survey-feel-great').props.accessibilityState).toMatchObject({ selected: false });
  fireEvent.press(screen.getByTestId('survey-crowd-yes'));
  fireEvent.press(screen.getByTestId('survey-save'));
  await outboxIdle();
  expect(dapi.putKaraokeLog).toHaveBeenLastCalledWith(KJ1, {
    survey: { key: 'too_low', crowd_pleaser: true, answered_at: expect.any(String) },
  });
});

it('the automatic survey waits while another Tonight sheet is open (the real version info sheet)', async () => {
  const version = { source: 'kn', priority_class: 'community', priority_display: 'Nomad', kn: { brand_code: 'NOMAD' } };
  function Screen({ info }: { info: boolean }) {
    return (
      <>
        <NightScreen night={night} focused />
        <VersionInfoSheet version={info ? version : null} onClose={() => {}} />
      </>
    );
  }
  api.getMe.mockResolvedValue(me({ sung_tonight: [sung('Starlight', KJ1)] }));
  const view = renderTonight(<Screen info />);
  expect(await screen.findByTestId('tonight-version-info')).toBeTruthy();
  await screen.findByTestId('tonight-freshness');
  await sleep(100);
  expect(screen.queryByTestId('survey')).toBeNull();
  view.rerender(<Screen info={false} />);
  expect(await screen.findByTestId('survey')).toBeTruthy();
  expect(useEditingStore.getState().sheets).toBe(0);
});

it('a sheet that unmounts while open releases its hold', () => {
  const version = { source: 'kn', kn: {} };
  const view = renderTonight(<VersionInfoSheet version={version} onClose={() => {}} />);
  expect(useEditingStore.getState().sheets).toBe(1);
  view.unmount();
  expect(useEditingStore.getState().sheets).toBe(0);
});

it('every Tonight sheet goes through TonightSheet', () => {
  const fs = jest.requireActual<typeof import('fs')>('fs');
  const path = jest.requireActual<typeof import('path')>('path');
  const root = path.join(__dirname, '../../../tonight');
  const files: string[] = [];
  const walk = (d: string) =>
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    });
  walk(root);
  walk(path.join(__dirname, '../../../app/tonight'));
  const offenders = files.filter((f) => {
    if (f.endsWith('TonightSheet.tsx')) return false;
    const src = fs.readFileSync(f, 'utf8');
    return /import\s*\{[^}]*\bSheet\b[^}]*\}\s*from\s*'@nomad\/ui'/.test(src) || /<Modal\b/.test(src);
  });
  expect(offenders).toEqual([]);
});

it('SurveySheet saveSurvey strips empty arrays', async () => {
  useLogStore.getState().saveSurvey('app_v6', { vibes: [], reasons: [] });
  await outboxIdle();
  expect(dapi.putKaraokeLog).toHaveBeenCalledWith('app_v6', { survey: { answered_at: expect.any(String) } });
});
