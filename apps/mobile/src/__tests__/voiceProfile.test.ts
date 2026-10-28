// Local voice profile (Phase 3c Task 18a): mappers from a mic result / self-report, the decide body, MMKV store.
import { classifyVoice, fitSong, summarizeRange, type RangeSummary } from '@nomad/core';
import { act } from '@testing-library/react-native';

import { useRecFilters } from '../discover/filtersStore';
import { appStorage } from '../storage';
import { followServerVoice } from '../voice/useVoiceProfile';
import {
  loadVoice,
  profileFromResult,
  profileFromSelfReport,
  toUserRange,
  toVoiceProfileIn,
  useVoiceStore,
  VOICE_STORAGE_KEY,
  type LocalVoiceProfile,
} from '../voice/voiceStore';

const API_KEYS = [
  'low_midi',
  'high_midi',
  'comfort_low',
  'comfort_high',
  'voice_type',
  'voice_type_between',
  'register',
  'confidence',
  'method',
  'measured_at',
].sort();

const AT = '2026-10-22T18:00:00.000Z';
const range: RangeSummary = { low: 45, high: 64, comfortLow: 50, comfortHigh: 59, heldCount: 6, freeVoicedS: 6 };

beforeEach(() => {
  appStorage.remove(VOICE_STORAGE_KEY);
  act(() => useVoiceStore.getState().clear());
});

describe('profileFromResult', () => {
  it('copies the range and classification, method mic; a narrow comfort is widened around its centre', () => {
    const c = classifyVoice(range);
    const p = profileFromResult(range, c, AT);
    expect(p).toEqual({
      lowMidi: 45,
      highMidi: 64,
      // free-sing comfort 50..59 is 10 keys: one short of 11, so the extra key goes to the top
      comfortLow: 50,
      comfortHigh: 60,
      voiceType: c.type,
      voiceTypeBetween: c.between,
      register: null,
      confidence: c.confidence,
      method: 'mic',
      measuredAt: AT,
    });
  });

  it.each<[string, Partial<RangeSummary>, [number, number]]>([
    ["Andrew's Pixel (E2..A4, free sing 52..58) widens symmetrically to 11 keys, not to the range", { low: 40, high: 69, comfortLow: 52, comfortHigh: 58 }, [50, 60]],
    ['an odd extra goes to the top', { low: 40, high: 69, comfortLow: 52, comfortHigh: 57 }, [50, 60]],
    ['a band at the bottom edge shifts up to keep its width', { low: 40, high: 69, comfortLow: 41, comfortHigh: 45 }, [40, 50]],
    ['a band at the top edge shifts down to keep its width', { low: 40, high: 69, comfortLow: 65, comfortHigh: 69 }, [59, 69]],
    ['a band already 11 keys wide stays as measured', { low: 40, high: 69, comfortLow: 50, comfortHigh: 60 }, [50, 60]],
    ['a band wider than 11 keys stays as measured', { low: 36, high: 72, comfortLow: 48, comfortHigh: 64 }, [48, 64]],
    ['a tiny range clamps to the range', { low: 50, high: 52, comfortLow: 51, comfortHigh: 51 }, [50, 52]],
    ['a 1-key range', { low: 50, high: 51, comfortLow: 50, comfortHigh: 51 }, [50, 51]],
  ])('comfort: %s', (_n, patch, [lo, hi]) => {
    const r = { ...range, ...patch };
    const p = profileFromResult(r, classifyVoice(r), AT);
    expect([p.comfortLow, p.comfortHigh]).toEqual([lo, hi]);
    expect(p.lowMidi <= p.comfortLow && p.comfortLow <= p.comfortHigh && p.comfortHigh <= p.highMidi).toBe(true);
  });

  it('a widened band is centred on the measured centre and never narrower than 11 keys', () => {
    const r = { ...range, low: 36, high: 72, comfortLow: 50, comfortHigh: 56 };
    const p = profileFromResult(r, classifyVoice(r), AT);
    expect(p.comfortHigh - p.comfortLow).toBe(10);
    expect((p.comfortLow + p.comfortHigh) / 2).toBe(53);
  });

  it('the fake-mic tester (A2-E4, free sing G3-C4) still gets a fit on a song near its centre', () => {
    const r = { ...range, low: 45, high: 64, comfortLow: 55, comfortHigh: 60 };
    const user = toUserRange(profileFromResult(r, classifyVoice(r), AT));
    expect([user.comfortLow, user.comfortHigh]).toEqual([53, 63]);
    const centred = { low: 51, high: 63, p10: 54, p50: 57, p90: 61, tier: 'measured' as const, octaveConfidence: null };
    expect(fitSong(user, centred).bucket).toBe('fits');
  });

  it('the voice type still comes from the free-sing centre (classifier input unchanged)', () => {
    const narrow = { ...range, comfortLow: 55, comfortHigh: 60 };
    const c = classifyVoice(narrow);
    expect(profileFromResult(narrow, c, AT).voiceType).toBe(c.type);
  });

  it('keeps the adjacent type when the classifier is between two', () => {
    const p = profileFromResult(range, { type: 'baritone', between: 'tenor', margin: 0.01, confidence: 'medium', scores: {} as never }, AT);
    expect(p.voiceTypeBetween).toBe('tenor');
  });
});

describe('profileFromSelfReport', () => {
  it('a voice type: its preset range, low confidence, method self', () => {
    expect(profileFromSelfReport('tenor', AT)).toEqual({
      lowMidi: 48,
      highMidi: 72,
      comfortLow: 53,
      comfortHigh: 67,
      voiceType: 'tenor',
      voiceTypeBetween: null,
      register: null,
      confidence: 'low',
      method: 'self',
      measuredAt: AT,
    });
  });

  it('a register: no voice type', () => {
    expect(profileFromSelfReport('lower', AT)).toMatchObject({ voiceType: null, register: 'lower', lowMidi: 40, method: 'self' });
  });
});

describe('toVoiceProfileIn', () => {
  it('sends exactly the decide API fields, snake_case', () => {
    const body = toVoiceProfileIn(profileFromSelfReport('tenor', AT));
    expect(Object.keys(body).sort()).toEqual(API_KEYS);
    expect(body).toEqual({
      low_midi: 48,
      high_midi: 72,
      comfort_low: 53,
      comfort_high: 67,
      voice_type: 'tenor',
      voice_type_between: null,
      register: null,
      confidence: 'low',
      method: 'self',
      measured_at: AT,
    });
  });

  it('drops anything else a stored profile picked up', () => {
    const extra = { ...profileFromResult(range, classifyVoice(range), AT), note: 'x' } as LocalVoiceProfile;
    expect(Object.keys(toVoiceProfileIn(extra)).sort()).toEqual(API_KEYS);
  });
});

describe('session profiles (written by decide, Phase 3d)', () => {
  const sessionProfile = (patch: Partial<LocalVoiceProfile> = {}): LocalVoiceProfile => ({
    ...profileFromSelfReport('tenor', AT),
    voiceTypeBetween: 'baritone',
    confidence: 'medium',
    method: 'session',
    evidenceCount: 5,
    sessionId: 'sess-1',
    ...patch,
  });

  it('toVoiceProfileIn refuses a session profile (the public PUT rejects method session)', () => {
    expect(() => toVoiceProfileIn(sessionProfile())).toThrow(/session/);
  });

  it('a mic/self body never carries evidence_count or session_id', () => {
    const p = { ...profileFromSelfReport('tenor', AT), evidenceCount: 3, sessionId: 'x' } as LocalVoiceProfile;
    expect(Object.keys(toVoiceProfileIn(p)).sort()).toEqual(API_KEYS);
  });

  it('loadVoice() reads a session profile back with its evidence count and session id', () => {
    const p = sessionProfile();
    appStorage.set(VOICE_STORAGE_KEY, JSON.stringify({ profile: p, pending: false }));
    expect(loadVoice()).toEqual({ profile: p, pending: false });
  });

  it('loadVoice() reads a session profile whose evidence count and session id are null', () => {
    const p = sessionProfile({ evidenceCount: null, sessionId: null });
    appStorage.set(VOICE_STORAGE_KEY, JSON.stringify({ profile: p, pending: false }));
    expect(loadVoice().profile).toEqual(p);
  });

  it('adopt() keeps the session fields', () => {
    act(() => useVoiceStore.getState().adopt(sessionProfile()));
    expect(useVoiceStore.getState().profile).toMatchObject({ method: 'session', evidenceCount: 5, sessionId: 'sess-1' });
    expect(loadVoice().profile).toMatchObject({ method: 'session', evidenceCount: 5, sessionId: 'sess-1' });
  });

  it('a mic/self profile stays without session keys', () => {
    act(() => useVoiceStore.getState().save(profileFromSelfReport('alto', AT)));
    expect(Object.keys(useVoiceStore.getState().profile!)).not.toContain('evidenceCount');
    expect(Object.keys(useVoiceStore.getState().profile!)).not.toContain('sessionId');
  });

  it.each([
    ['a negative evidence count', { evidenceCount: -1 }],
    ['a fractional evidence count', { evidenceCount: 1.5 }],
    ['a numeric session id', { sessionId: 7 as unknown as string }],
    ['an unknown method', { method: 'guess' as never }],
  ])('loadVoice() drops %s', (_n, patch) => {
    appStorage.set(VOICE_STORAGE_KEY, JSON.stringify({ profile: sessionProfile(patch), pending: false }));
    expect(loadVoice().profile).toBeNull();
  });
});

it('toUserRange gives fitSong its four numbers', () => {
  expect(toUserRange(profileFromSelfReport('tenor', AT))).toEqual({ low: 48, high: 72, comfortLow: 53, comfortHigh: 67 });
});

describe('useVoiceStore', () => {
  it('starts empty', () => {
    expect(useVoiceStore.getState()).toMatchObject({ profile: null, pending: false });
  });

  it('save() keeps the profile pending and persists it', () => {
    const p = profileFromSelfReport('alto', AT);
    act(() => useVoiceStore.getState().save(p));
    expect(useVoiceStore.getState()).toMatchObject({ profile: p, pending: true });
    expect(loadVoice()).toEqual({ profile: p, pending: true });
  });

  it('markSynced() clears pending only for the same measurement', () => {
    const p = profileFromSelfReport('alto', AT);
    act(() => useVoiceStore.getState().save(p));
    act(() => useVoiceStore.getState().markSynced('2026-01-01T00:00:00.000Z'));
    expect(useVoiceStore.getState().pending).toBe(true);
    act(() => useVoiceStore.getState().markSynced(AT));
    expect(useVoiceStore.getState().pending).toBe(false);
    expect(loadVoice()).toEqual({ profile: p, pending: false });
  });

  it('clear() forgets this phone\'s copy', () => {
    act(() => useVoiceStore.getState().save(profileFromSelfReport('alto', AT)));
    act(() => useVoiceStore.getState().clear());
    expect(useVoiceStore.getState()).toMatchObject({ profile: null, pending: false });
    expect(appStorage.getString(VOICE_STORAGE_KEY)).toBeUndefined();
  });

  it('loadVoice() drops a corrupt or wrong-shaped copy', () => {
    appStorage.set(VOICE_STORAGE_KEY, '{nope');
    expect(loadVoice()).toEqual({ profile: null, pending: false });
    expect(appStorage.getString(VOICE_STORAGE_KEY)).toBeUndefined();
    appStorage.set(VOICE_STORAGE_KEY, JSON.stringify({ profile: { lowMidi: 'a' }, pending: true }));
    expect(loadVoice()).toEqual({ profile: null, pending: false });
    const bad = { ...profileFromSelfReport('alto', AT), voiceType: 'whistle' };
    appStorage.set(VOICE_STORAGE_KEY, JSON.stringify({ profile: bad, pending: true }));
    expect(loadVoice().profile).toBeNull();
  });

  it.each([
    ['low above high', { lowMidi: 70, highMidi: 60 }],
    ['comfort below low', { comfortLow: 40 }],
    ['comfort above high', { comfortHigh: 80 }],
    ['comfort inverted', { comfortLow: 65, comfortHigh: 55 }],
  ])('loadVoice() drops an impossible range (%s)', (_name, patch) => {
    const p = { ...profileFromSelfReport('tenor', AT), ...patch }; // tenor: 48..72, comfort 53..67
    appStorage.set(VOICE_STORAGE_KEY, JSON.stringify({ profile: p, pending: true }));
    expect(loadVoice()).toEqual({ profile: null, pending: false });
  });

  it('loadVoice() reads a mic profile back', () => {
    const held = [45, 50, 55, 59, 64].map((note, i) => ({ note, midi: note, start: i, end: i + 1 }));
    const r = summarizeRange(held, [])!;
    const p = profileFromResult(r, classifyVoice(r), AT);
    appStorage.set(VOICE_STORAGE_KEY, JSON.stringify({ profile: p, pending: false }));
    expect(loadVoice()).toEqual({ profile: p, pending: false });
  });

  it('loadVoice() reads back a profile adopted from a decide voice session (method session)', () => {
    const p = { ...profileFromSelfReport('tenor', AT), method: 'session' as const, confidence: 'high' as const };
    appStorage.set(VOICE_STORAGE_KEY, JSON.stringify({ profile: p, pending: false }));
    expect(loadVoice()).toEqual({ profile: p, pending: false });
  });
});

describe('followServerVoice (decide changed the saved profile itself)', () => {
  const LOCAL: LocalVoiceProfile = {
    lowMidi: 46, highMidi: 70, comfortLow: 50, comfortHigh: 60, voiceType: 'baritone', voiceTypeBetween: null,
    register: null, confidence: 'low', method: 'session', measuredAt: '2026-10-25T18:00:00.000Z', sessionId: 's1',
  };
  const MIC_OUT = {
    low_midi: 43, high_midi: 67, comfort_low: 48, comfort_high: 58, voice_type: 'bass', voice_type_between: null,
    register: null, confidence: 'medium', method: 'mic', measured_at: '2026-10-20T10:00:00.000Z',
    updated_at: '2026-10-20T10:00:01Z',
  } as const;

  it('an older server profile is still adopted (a revert to the mic result)', () => {
    act(() => useVoiceStore.getState().adopt(LOCAL));
    act(() => followServerVoice(MIC_OUT));
    expect(useVoiceStore.getState()).toMatchObject({
      pending: false,
      profile: expect.objectContaining({ method: 'mic', voiceType: 'bass', measuredAt: MIC_OUT.measured_at }),
    });
  });

  it('a pending local measurement is kept', () => {
    act(() => useVoiceStore.getState().save(LOCAL));
    act(() => followServerVoice(MIC_OUT));
    expect(useVoiceStore.getState()).toMatchObject({ pending: true, profile: expect.objectContaining({ method: 'session' }) });
    act(() => followServerVoice(null));
    expect(useVoiceStore.getState().profile?.method).toBe('session');
  });

  it('null clears the profile and turns off Singable and sort by fit', () => {
    act(() => useVoiceStore.getState().adopt(LOCAL));
    act(() => useRecFilters.getState().set({ singable: true, sort: 'fit' }));
    act(() => followServerVoice(null));
    expect(useVoiceStore.getState().profile).toBeNull();
    expect(useRecFilters.getState().filters).toMatchObject({ singable: false, sort: 'best' });
  });
});

describe('falsetto top (batch 1, M10)', () => {
  it('profileFromResult keeps the falsetto top beside the chest range', () => {
    const p = profileFromResult(range, classifyVoice(range), AT, 69);
    expect(p.falsettoHigh).toBe(69);
    expect(p.highMidi).toBe(64);
    expect(profileFromResult(range, classifyVoice(range), AT)).not.toHaveProperty('falsettoHigh');
  });

  it('PUT body includes falsetto_high (only when there is one)', () => {
    const body = toVoiceProfileIn(profileFromResult(range, classifyVoice(range), AT, 69));
    expect(body.falsetto_high).toBe(69);
    expect(Object.keys(body).sort()).toEqual([...API_KEYS, 'falsetto_high'].sort());
    expect(toVoiceProfileIn(profileFromResult(range, classifyVoice(range), AT))).not.toHaveProperty('falsetto_high');
  });

  it('loadVoice() reads the falsetto top back; a bad one drops the copy', () => {
    act(() => useVoiceStore.getState().save(profileFromResult(range, classifyVoice(range), AT, 69)));
    expect(loadVoice().profile?.falsettoHigh).toBe(69);
    const p = { ...profileFromResult(range, classifyVoice(range), AT), falsettoHigh: 40 };
    appStorage.set(VOICE_STORAGE_KEY, JSON.stringify({ profile: p, pending: false }));
    expect(loadVoice().profile).toBeNull();
  });
});
