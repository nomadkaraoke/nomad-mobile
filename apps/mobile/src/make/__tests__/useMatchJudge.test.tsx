import type { MatchVerdict } from '@nomad/api-gen';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { logEvent } from '../../find/searchSession';
import { gen } from '../../test-utils/genAuthMock';
import type { MakeIntent } from '../intentStore';
import { JUDGE_GATE_TIMEOUT_MS, useMatchJudge, type JudgeSearch } from '../useMatchJudge';

jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), matchJudge: jest.fn() }));
jest.mock('../../find/searchSession', () => ({ logEvent: jest.fn() }));

const intent = (over: Partial<MakeIntent> = {}): MakeIntent => ({
  artist: 'queen',
  title: 'bohemian rapsody',
  source: 'typed',
  editedFields: [],
  createdAt: Date.now(),
  ...over,
});

const verdict = (over: Partial<MatchVerdict> = {}): MatchVerdict => ({
  kind: 'none',
  confident: true,
  canonical_artist: 'queen',
  canonical_title: 'bohemian rapsody',
  alternatives: [],
  engine: 'catalog',
  reason: '',
  needs_ai: false,
  ...over,
});

const FIXED = { canonical_artist: 'Queen', canonical_title: 'Bohemian Rhapsody' };

/** Drives the hook like the make screen: `tier` null while the first audio search runs. */
function setup(i: MakeIntent | null = intent()) {
  const reSearch = jest.fn();
  const hook = renderHook(
    ({ tier }: { tier: JudgeSearch['tier'] }) => useMatchJudge(i, { tier, reSearch }),
    { initialProps: { tier: null as JudgeSearch['tier'] } },
  );
  const searchDone = async (tier: 1 | 2 | 3) => {
    await act(async () => hook.rerender({ tier }));
  };
  return { ...hook, reSearch, searchDone };
}

const fastCalls = () => gen.matchJudge.mock.calls.filter(([b]) => b.stage === 'fast');
const fullCalls = () => gen.matchJudge.mock.calls.filter(([b]) => b.stage === 'full');

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

it('fires the fast judge once on mount with what is shown', async () => {
  gen.matchJudge.mockResolvedValue(verdict());
  const { result } = setup();
  await waitFor(() => expect(fastCalls()).toHaveLength(1));
  expect(gen.matchJudge).toHaveBeenCalledWith({ artist: 'queen', title: 'bohemian rapsody', stage: 'fast' });
  expect(result.current.state).toBe('pending');
  expect(result.current.gateOpen).toBe(false);
  expect(result.current.applied).toEqual({ artist: 'queen', title: 'bohemian rapsody' });
});

it('does nothing without an intent', () => {
  const { result } = setup(null);
  expect(gen.matchJudge).not.toHaveBeenCalled();
  expect(result.current.applied).toBeNull();
});

it('a confident cosmetic fast verdict applies at once, and no full call follows', async () => {
  gen.matchJudge.mockResolvedValue(verdict({ kind: 'cosmetic', ...FIXED }));
  const { result, searchDone, reSearch } = setup();
  await waitFor(() => expect(result.current.applied).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody' }));
  expect(result.current.correction).toMatchObject({ kind: 'cosmetic', active: true });
  await searchDone(1);
  await waitFor(() => expect(result.current.state).toBe('settled'));
  expect(result.current.gateOpen).toBe(true);
  expect(fullCalls()).toHaveLength(0);
  expect(reSearch).not.toHaveBeenCalled();
});

it('a confident catalogue fast verdict on weak audio (tier 3) still asks the full judge', async () => {
  gen.matchJudge.mockResolvedValue(verdict());
  const { searchDone } = setup();
  await waitFor(() => expect(fastCalls()).toHaveLength(1));
  await searchDone(3);
  await waitFor(() => expect(fullCalls()).toHaveLength(1));
});

it('fast needs_ai → a full call with the tier, using what is shown', async () => {
  gen.matchJudge.mockImplementation(async (b) =>
    b.stage === 'fast' ? verdict({ needs_ai: true, confident: false }) : verdict(),
  );
  const { result, searchDone } = setup();
  await waitFor(() => expect(fastCalls()).toHaveLength(1));
  await searchDone(2);
  await waitFor(() => expect(result.current.state).toBe('settled'));
  expect(gen.matchJudge).toHaveBeenLastCalledWith({
    artist: 'queen',
    title: 'bohemian rapsody',
    stage: 'full',
    audio_confidence_tier: 2,
  });
});

it('a failed fast pass counts as null: the full judge runs', async () => {
  gen.matchJudge.mockImplementation(async (b) => {
    if (b.stage === 'fast') throw new Error('offline');
    return verdict();
  });
  const { result, searchDone } = setup();
  await searchDone(1);
  await waitFor(() => expect(result.current.state).toBe('settled'));
  expect(fullCalls()).toHaveLength(1);
});

it('confident content at tier 1 applies without searching again', async () => {
  gen.matchJudge.mockImplementation(async (b) =>
    b.stage === 'fast' ? verdict({ needs_ai: true }) : verdict({ kind: 'content', engine: 'ai', ...FIXED }),
  );
  const { result, searchDone, reSearch } = setup();
  await searchDone(1);
  await waitFor(() => expect(result.current.state).toBe('settled'));
  expect(result.current.applied).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody' });
  expect(result.current.correction).toMatchObject({
    kind: 'content',
    from: { artist: 'queen', title: 'bohemian rapsody' },
    active: true,
  });
  expect(reSearch).not.toHaveBeenCalled();
});

it('confident content at tier 3 applies and searches again exactly once, with the corrected song', async () => {
  gen.matchJudge.mockImplementation(async (b) =>
    b.stage === 'fast' ? verdict({ needs_ai: true }) : verdict({ kind: 'content', engine: 'ai', ...FIXED }),
  );
  const { result, searchDone, reSearch, rerender } = setup();
  await searchDone(3);
  await waitFor(() => expect(result.current.state).toBe('settled'));
  expect(reSearch).toHaveBeenCalledTimes(1);
  expect(reSearch).toHaveBeenCalledWith({ artist: 'Queen', title: 'Bohemian Rhapsody' });
  // The re-search runs (tier back to null), then lands: no second judge, no second search.
  await act(async () => rerender({ tier: null }));
  await act(async () => rerender({ tier: 1 }));
  expect(reSearch).toHaveBeenCalledTimes(1);
  expect(fullCalls()).toHaveLength(1);
});

it('unconfident content applies nothing and offers it as Did you mean', async () => {
  gen.matchJudge.mockImplementation(async (b) =>
    b.stage === 'fast'
      ? verdict({ needs_ai: true })
      : verdict({ kind: 'content', confident: false, engine: 'ai', ...FIXED }),
  );
  const { result, searchDone } = setup();
  await searchDone(2);
  await waitFor(() => expect(result.current.state).toBe('settled'));
  expect(result.current.correction).toBeNull();
  expect(result.current.suggestions).toEqual([{ artist: 'Queen', title: 'Bohemian Rhapsody' }]);
});

it('ambiguous shows Did you mean; accepting an option applies it, searches again and logs it', async () => {
  gen.matchJudge.mockImplementation(async (b) =>
    b.stage === 'fast'
      ? verdict({ needs_ai: true })
      : verdict({
          kind: 'ambiguous',
          confident: false,
          engine: 'ai',
          ...FIXED,
          alternatives: [{ artist: 'Panic! at the Disco', title: 'Bohemian Rhapsody' }, { artist: '', title: 'x' }],
        }),
  );
  const { result, searchDone, reSearch } = setup();
  await searchDone(2);
  await waitFor(() => expect(result.current.suggestions).toHaveLength(2));
  expect(result.current.kind).toBe('ambiguous');
  expect(result.current.applied).toEqual({ artist: 'queen', title: 'bohemian rapsody' });
  act(() => result.current.acceptAlternative(1));
  expect(result.current.applied).toEqual({ artist: 'Panic! at the Disco', title: 'Bohemian Rhapsody' });
  expect(result.current.suggestions).toEqual([]);
  expect(result.current.correction).toMatchObject({ kind: 'content', active: true });
  expect(reSearch).toHaveBeenCalledWith({ artist: 'Panic! at the Disco', title: 'Bohemian Rhapsody' });
  expect(logEvent).toHaveBeenCalledWith('pick_candidate', { where: 'make', index: 1 });
});

it('undo and redo swap metadata only and log keep_typed / reapply_tidy', async () => {
  gen.matchJudge.mockResolvedValue(verdict({ kind: 'cosmetic', ...FIXED }));
  const { result, reSearch } = setup();
  await waitFor(() => expect(result.current.correction?.active).toBe(true));
  act(() => result.current.undo());
  expect(result.current.applied).toEqual({ artist: 'queen', title: 'bohemian rapsody' });
  expect(result.current.correction?.active).toBe(false);
  expect(logEvent).toHaveBeenLastCalledWith('keep_typed', { where: 'make', kind: 'cosmetic' });
  act(() => result.current.redo());
  expect(result.current.applied).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody' });
  expect(result.current.correction?.active).toBe(true);
  expect(logEvent).toHaveBeenLastCalledWith('reapply_tidy', { where: 'make', kind: 'cosmetic' });
  expect(reSearch).not.toHaveBeenCalled();
});

it('Review Focus 5: a title the user changed from the pre-fill is never overwritten; Undo restores what was shown', async () => {
  // Pre-filled from an identified song, then the user changed the title before making it.
  const edited = intent({
    artist: 'queen',
    title: 'Bohemian Rhapsody (Live Aid)',
    canonicalArtist: 'Queen',
    canonicalTitle: 'Bohemian Rhapsody',
    songKey: 'queen|bohemian rhapsody',
    editedFields: ['title'],
  });
  gen.matchJudge.mockResolvedValue(verdict({ kind: 'cosmetic', ...FIXED }));
  const { result } = setup(edited);
  await waitFor(() => expect(result.current.correction).not.toBeNull());
  expect(result.current.applied).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody (Live Aid)' });
  act(() => result.current.undo());
  expect(result.current.applied).toEqual({ artist: 'queen', title: 'Bohemian Rhapsody (Live Aid)' });
});

it('a correction that only touches protected fields changes nothing and shows no notice', async () => {
  const edited = intent({ canonicalArtist: 'Queen', canonicalTitle: 'Bohemian Rhapsody', editedFields: ['artist', 'title'] });
  gen.matchJudge.mockResolvedValue(verdict({ kind: 'cosmetic', ...FIXED }));
  const { result, searchDone } = setup(edited);
  await searchDone(1);
  await waitFor(() => expect(result.current.state).toBe('settled'));
  expect(result.current.correction).toBeNull();
  expect(result.current.applied).toEqual({ artist: 'queen', title: 'bohemian rapsody' });
});

it('typed from scratch (no pre-fill to protect): the judge may fix what was typed', async () => {
  gen.matchJudge.mockResolvedValue(verdict({ kind: 'cosmetic', ...FIXED }));
  const { result } = setup(intent({ editedFields: ['artist', 'title'] }));
  await waitFor(() => expect(result.current.applied).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody' }));
});

it('the gate opens at the timeout when the full judge hangs', async () => {
  jest.useFakeTimers();
  gen.matchJudge.mockImplementation((b) =>
    b.stage === 'fast' ? Promise.resolve(verdict({ needs_ai: true })) : new Promise<MatchVerdict>(() => {}),
  );
  const { result, searchDone } = setup();
  await searchDone(2);
  expect(result.current.gateOpen).toBe(false);
  await act(async () => jest.advanceTimersByTime(JUDGE_GATE_TIMEOUT_MS - 1));
  expect(result.current.gateOpen).toBe(false);
  await act(async () => jest.advanceTimersByTime(1));
  expect(result.current.gateOpen).toBe(true);
  expect(result.current.state).toBe('pending');
});

it('a failed full judge still settles and opens the gate', async () => {
  gen.matchJudge.mockImplementation(async (b) => {
    if (b.stage === 'fast') return verdict({ needs_ai: true });
    throw new Error('500');
  });
  const { result, searchDone } = setup();
  await searchDone(2);
  await waitFor(() => expect(result.current.state).toBe('settled'));
  expect(result.current.gateOpen).toBe(true);
  expect(result.current.correction).toBeNull();
});
