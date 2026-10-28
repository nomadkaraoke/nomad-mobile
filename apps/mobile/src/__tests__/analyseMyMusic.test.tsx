// "Analyse my music" (Phase 3d Part F, F2): the personal-pool card's states from decide's pool, the request and its
// refusals (429 cap, 503 budget_paused / warming_up, 409 nothing_to_add / concurrent_request), and when it hides.
import * as decide from '@nomad/api-decide';
import { IntlProvider } from '@nomad/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useAuth } from '../auth/store';
import { gen, session } from '../test-utils/genAuthMock';
import { AnalyseMyMusicCard } from '../voiceSession/personal/AnalyseMyMusicCard';
import { personalPoolView } from '../voiceSession/personal/usePersonalPool';

// The card runs outside a navigator here: a focus effect is just an effect (the first call is mount), and the
// latest callback is kept so a test can "come back to Me" (`refocus`).
const mockFocus: { cb: (() => void) | null } = { cb: null };
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require('react');
  return {
    ...jest.requireActual('expo-router'),
    router: { push: jest.fn() },
    useFocusEffect: (cb: () => void) => {
      mockFocus.cb = cb;
      useEffect(cb, [cb]);
    },
  };
});
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  configureClient: jest.fn(),
  getVoiceFlags: jest.fn(),
  getPersonalPool: jest.fn(),
  requestPersonalPool: jest.fn(),
}));

const m = (f: unknown) => f as jest.Mock;
type Pool = Awaited<ReturnType<typeof decide.getPersonalPool>>;
type Batch = Pool['batches'][number];

const POOL: Pool = {
  eligible: true,
  reason: 'history',
  listens: 1320,
  songs_with_plays: 8,
  next_allowed_at: null,
  cap: 20,
  used: 0,
  batches: [],
};
const batch = (over: Partial<Batch> = {}): Batch => ({
  batch_id: 'b1',
  requested_at: '2026-10-27T10:00:00Z',
  total: 20,
  ready: 0,
  status: 'queued',
  ...over,
});
const NEXT = '2026-11-20T19:04:11.123456+00:00';

let client: QueryClient;
const renderCard = (props: { onFindVoice?: () => void } = {}) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <IntlProvider locale="en">
      <QueryClientProvider client={client}>
        <AnalyseMyMusicCard {...props} />
      </QueryClientProvider>
    </IntlProvider>,
  );
};
/** Waits for the first read, then the card (or its absence). */
const settled = async () => waitFor(() => expect(m(decide.getPersonalPool)).toHaveBeenCalled());
/** Me comes back into focus. */
const refocus = () => act(async () => mockFocus.cb?.());
/**
 * Waits for `check` after a refocus, letting React and TanStack flush inside act between tries. On CI's runner
 * RNTL's waitFor never saw the refocus read's update land (the gate's 403, a newer read clearing a refusal), while
 * a real sleep did; locally both worked.
 */
const until = async (check: () => void) => {
  for (let i = 0; i < 100; i++) {
    try {
      check();
      return;
    } catch {
      await act(() => new Promise((r) => setTimeout(r, 20)));
    }
  }
  check();
};
const flags = (session_enabled: boolean) => ({ session_enabled, is_admin: false, voice_data: true, active_session_id: null });

beforeEach(async () => {
  jest.clearAllMocks();
  mockFocus.cb = null;
  m(decide.getVoiceFlags).mockResolvedValue(flags(true));
  m(decide.getPersonalPool).mockResolvedValue(POOL);
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('analyseMyMusic: states', () => {
  it('idle: the pitch with the cap and the request button', async () => {
    renderCard();
    expect(await screen.findByTestId('vs-personal')).toBeTruthy();
    expect(screen.getByText('Analyse my music')).toBeTruthy();
    expect(screen.getByTestId('vs-personal-body')).toHaveTextContent("We'll prepare up to 20 songs you listen to most, overnight.");
    expect(screen.getByTestId('vs-personal-request')).toHaveTextContent('Prepare my songs');
  });

  it('requested / running: "Preparing {total}" and no button', async () => {
    m(decide.getPersonalPool).mockResolvedValue({ ...POOL, used: 12, batches: [batch({ total: 12, status: 'running' })] });
    renderCard();
    expect(await screen.findByTestId('vs-personal-preparing')).toHaveTextContent('Preparing 12 of your songs…');
    expect(screen.queryByTestId('vs-personal-request')).toBeNull();
    expect(screen.queryByTestId('vs-personal-body')).toBeNull();
  });

  it('ready: "{ready} of your songs are ready" opens the voice session', async () => {
    m(decide.getPersonalPool).mockResolvedValue({ ...POOL, used: 20, batches: [batch({ ready: 12, status: 'done' })] });
    renderCard();
    const ready = await screen.findByTestId('vs-personal-ready');
    expect(ready).toHaveTextContent('12 of your songs are ready — find your voice');
    fireEvent.press(ready);
    expect(router.push).toHaveBeenCalledWith('/discover/voice-session');
    // Under the cap with the batch done: the singer can ask again.
    expect(screen.getByTestId('vs-personal-request')).toBeTruthy();
  });

  it('ready, one song: singular', async () => {
    m(decide.getPersonalPool).mockResolvedValue({ ...POOL, batches: [batch({ total: 1, ready: 1, status: 'done' })] });
    renderCard();
    expect(await screen.findByTestId('vs-personal-ready')).toHaveTextContent('1 of your songs is ready — find your voice');
  });

  it('ready while still preparing: both lines; the intro passes its own action', async () => {
    const onFindVoice = jest.fn();
    m(decide.getPersonalPool).mockResolvedValue({ ...POOL, batches: [batch({ ready: 3, status: 'running' })] });
    renderCard({ onFindVoice });
    expect(await screen.findByTestId('vs-personal-preparing')).toHaveTextContent('Preparing 20 of your songs…');
    fireEvent.press(screen.getByTestId('vs-personal-ready'));
    expect(onFindVoice).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('cap: "You can ask again on {date}" and no button', async () => {
    m(decide.getPersonalPool).mockResolvedValue({
      ...POOL,
      used: 20,
      next_allowed_at: NEXT,
      batches: [batch({ ready: 0, status: 'done' })],
    });
    renderCard();
    expect(await screen.findByTestId('vs-personal-cap')).toHaveTextContent('You can ask again on Nov 20, 2026');
    expect(screen.queryByTestId('vs-personal-request')).toBeNull();
  });

  it('uses the newest batch (batches[0])', () => {
    const view = personalPoolView({
      ...POOL,
      batches: [batch({ batch_id: 'new', total: 5, status: 'running' }), batch({ batch_id: 'old', ready: 20, status: 'done' })],
    });
    expect(view).toMatchObject({ kind: 'shown', preparing: 5, ready: 0, canRequest: false, firstTime: false });
  });
});

describe('analyseMyMusic: reads', () => {
  it('reads the pool on mount and again each time Me comes back into focus', async () => {
    renderCard();
    await screen.findByTestId('vs-personal-request');
    expect(decide.getPersonalPool).toHaveBeenCalledTimes(1);
    m(decide.getPersonalPool).mockResolvedValue({ ...POOL, batches: [batch({ total: 6, status: 'running' })] });
    await refocus();
    expect(await screen.findByTestId('vs-personal-preparing')).toHaveTextContent('Preparing 6 of your songs…');
    expect(decide.getPersonalPool).toHaveBeenCalledTimes(2);
  });
});

describe('analyseMyMusic: hidden', () => {
  it('not eligible', async () => {
    m(decide.getPersonalPool).mockResolvedValue({ ...POOL, eligible: false, reason: 'not_eligible' });
    renderCard();
    await settled();
    await act(async () => {});
    expect(screen.queryByTestId('vs-personal')).toBeNull();
  });

  it('the read fails', async () => {
    m(decide.getPersonalPool).mockRejectedValue(new decide.ApiError(500, 'Internal Server Error'));
    renderCard();
    await settled();
    await act(async () => {});
    expect(screen.queryByTestId('vs-personal')).toBeNull();
  });

  it('the session gate is closed (403 voice_session_disabled)', async () => {
    m(decide.getPersonalPool).mockRejectedValue(new decide.ApiError(403, 'voice_session_disabled'));
    renderCard();
    await settled();
    await act(async () => {});
    expect(screen.queryByTestId('vs-personal')).toBeNull();
  });

  it('while the first read is loading: nothing, not a spinner', async () => {
    m(decide.getPersonalPool).mockReturnValue(new Promise(() => {}));
    renderCard();
    await settled();
    expect(screen.toJSON()).toBeNull();
  });

  it('the session flag is closed for this user: no read at all, no card', async () => {
    m(decide.getVoiceFlags).mockResolvedValue(flags(false));
    renderCard();
    await waitFor(() => expect(decide.getVoiceFlags).toHaveBeenCalled());
    await act(async () => {});
    await refocus();
    expect(decide.getPersonalPool).not.toHaveBeenCalled();
    expect(screen.queryByTestId('vs-personal')).toBeNull();
  });

  it('a later failed read keeps the last pool', async () => {
    renderCard();
    await screen.findByTestId('vs-personal-request');
    m(decide.getPersonalPool).mockRejectedValue(new decide.ApiError(500, 'Internal Server Error'));
    await refocus();
    await waitFor(() => expect(decide.getPersonalPool).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('vs-personal-request')).toBeTruthy();
  });

  it('the gate closes on a later read: hidden over the last pool', async () => {
    renderCard();
    await screen.findByTestId('vs-personal-request');
    m(decide.getPersonalPool).mockRejectedValue(new decide.ApiError(403, 'voice_session_disabled'));
    await refocus();
    await until(() => expect(screen.queryByTestId('vs-personal')).toBeNull());
  });

  it('signed out: no read, no card', async () => {
    await act(() => useAuth.getState().signOut());
    renderCard();
    await act(async () => {});
    expect(decide.getPersonalPool).not.toHaveBeenCalled();
    expect(screen.queryByTestId('vs-personal')).toBeNull();
  });
});

describe('analyseMyMusic: the request', () => {
  // The request's last step (busy off after the refetch) can land after an assertion: let it settle.
  afterEach(() => act(async () => {}));

  it('POSTs, then reads the pool again and shows "Preparing"', async () => {
    m(decide.requestPersonalPool).mockResolvedValue({ batch_id: 'b1', songs: ['a|b'], est_cost_usd: 0.027 });
    renderCard();
    fireEvent.press(await screen.findByTestId('vs-personal-request'));
    m(decide.getPersonalPool).mockResolvedValue({ ...POOL, used: 8, batches: [batch({ total: 8 })] });
    expect(await screen.findByTestId('vs-personal-preparing')).toHaveTextContent('Preparing 8 of your songs…');
    expect(decide.requestPersonalPool).toHaveBeenCalledTimes(1);
    expect(decide.getPersonalPool).toHaveBeenCalledTimes(2);
  });

  it('429 cap: the refusal date, no button', async () => {
    m(decide.requestPersonalPool).mockRejectedValue(new decide.ApiError(429, { reason: 'cap', next_allowed_at: NEXT }));
    renderCard();
    fireEvent.press(await screen.findByTestId('vs-personal-request'));
    expect(await screen.findByTestId('vs-personal-cap')).toHaveTextContent('You can ask again on Nov 20, 2026');
    expect(screen.queryByTestId('vs-personal-request')).toBeNull();
  });

  it('503 budget_paused: "Busy right now"', async () => {
    m(decide.requestPersonalPool).mockRejectedValue(new decide.ApiError(503, { reason: 'budget_paused' }));
    renderCard();
    fireEvent.press(await screen.findByTestId('vs-personal-request'));
    expect(await screen.findByTestId('vs-personal-paused')).toHaveTextContent('Busy right now, try again tomorrow');
  });

  it('409 nothing_to_add: says so', async () => {
    m(decide.requestPersonalPool).mockRejectedValue(new decide.ApiError(409, { reason: 'nothing_to_add' }));
    renderCard();
    fireEvent.press(await screen.findByTestId('vs-personal-request'));
    expect(await screen.findByTestId('vs-personal-nothing')).toHaveTextContent(/already got your top songs/);
  });

  it('409 concurrent_request: no error, the refetch shows the other batch', async () => {
    m(decide.requestPersonalPool).mockRejectedValue(new decide.ApiError(409, { reason: 'concurrent_request' }));
    renderCard();
    fireEvent.press(await screen.findByTestId('vs-personal-request'));
    m(decide.getPersonalPool).mockResolvedValue({ ...POOL, batches: [batch({ total: 15 })] });
    expect(await screen.findByTestId('vs-personal-preparing')).toHaveTextContent('Preparing 15 of your songs…');
    expect(screen.queryByTestId('vs-personal-failed')).toBeNull();
  });

  it('503 warming_up: try again shortly, button stays', async () => {
    m(decide.requestPersonalPool).mockRejectedValue(new decide.ApiError(503, 'warming_up'));
    renderCard();
    fireEvent.press(await screen.findByTestId('vs-personal-request'));
    expect(await screen.findByTestId('vs-personal-failed')).toHaveTextContent("Couldn't ask just now. Try again in a minute.");
    expect(screen.getByTestId('vs-personal-request')).toBeTruthy();
  });

  it('a refusal clears on the next read of the pool', async () => {
    m(decide.requestPersonalPool).mockRejectedValue(new decide.ApiError(503, { reason: 'budget_paused' }));
    renderCard();
    fireEvent.press(await screen.findByTestId('vs-personal-request'));
    await screen.findByTestId('vs-personal-paused');
    await new Promise((r) => setTimeout(r, 5)); // the next read is newer than the refusal
    await refocus();
    await until(() => expect(decide.getPersonalPool).toHaveBeenCalledTimes(3));
    await until(() => expect(screen.queryByTestId('vs-personal-paused')).toBeNull());
    expect(screen.getByTestId('vs-personal-request')).toBeTruthy();
  });

  it('a cap refusal whose date has passed is dropped', async () => {
    m(decide.requestPersonalPool).mockRejectedValue(
      new decide.ApiError(429, { reason: 'cap', next_allowed_at: '2020-01-01T00:00:00+00:00' }),
    );
    renderCard();
    fireEvent.press(await screen.findByTestId('vs-personal-request'));
    await waitFor(() => expect(decide.getPersonalPool).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByTestId('vs-personal-cap')).toBeNull();
    expect(screen.getByTestId('vs-personal-request')).toBeTruthy();
  });

  it('another account: the last one\'s refusal is gone', async () => {
    m(decide.requestPersonalPool).mockRejectedValue(new decide.ApiError(409, { reason: 'nothing_to_add' }));
    renderCard();
    fireEvent.press(await screen.findByTestId('vs-personal-request'));
    await screen.findByTestId('vs-personal-nothing');
    gen.getMe.mockResolvedValue({ email: 'other@example.com', credits: 3 } as never);
    await act(() => useAuth.getState().signInWithSession(session('other@example.com')));
    await waitFor(() => expect(decide.getPersonalPool).toHaveBeenCalledTimes(3));
    await act(async () => {});
    expect(screen.queryByTestId('vs-personal-nothing')).toBeNull();
    expect(screen.getByTestId('vs-personal-request')).toBeTruthy();
  });

  it('403 not_eligible: hides the card', async () => {
    m(decide.requestPersonalPool).mockRejectedValue(new decide.ApiError(403, { reason: 'not_eligible' }));
    renderCard();
    fireEvent.press(await screen.findByTestId('vs-personal-request'));
    await waitFor(() => expect(decide.getPersonalPool).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByTestId('vs-personal')).toBeNull();
  });
});
