// Local voice profile (Phase 3c Task 18a): mappers from a mic result / self-report, the decide body, MMKV store.
import { classifyVoice, fitSong, summarizeRange, type RangeSummary } from '@nomad/core';
import { act } from '@testing-library/react-native';

import { appStorage } from '../storage';
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
  it('copies the range and classification, method mic; comfort widened to 2 keys inside the range', () => {
    const c = classifyVoice(range);
    const p = profileFromResult(range, c, AT);
    expect(p).toEqual({
      lowMidi: 45,
      highMidi: 64,
      // free-sing comfort 50..59 (9 keys) -> min(50, 45+2) .. max(59, 64-2)
      comfortLow: 47,
      comfortHigh: 62,
      voiceType: c.type,
      voiceTypeBetween: c.between,
      register: null,
      confidence: c.confidence,
      method: 'mic',
      measuredAt: AT,
    });
  });

  it.each<[string, Partial<RangeSummary>, [number, number]]>([
    ['a narrow free sing (the fake mic: G3..C4) widens', { low: 45, high: 64, comfortLow: 55, comfortHigh: 60 }, [47, 62]],
    ['a free sing wider than range-2 keeps its own edges', { low: 45, high: 64, comfortLow: 46, comfortHigh: 63 }, [46, 63]],
    ['a tiny range stays inside it (clamped)', { low: 50, high: 52, comfortLow: 51, comfortHigh: 51 }, [51, 51]],
    ['a 1-key range', { low: 50, high: 51, comfortLow: 50, comfortHigh: 51 }, [50, 51]],
  ])('comfort: %s', (_n, patch, [lo, hi]) => {
    const r = { ...range, ...patch };
    const p = profileFromResult(r, classifyVoice(r), AT);
    expect([p.comfortLow, p.comfortHigh]).toEqual([lo, hi]);
    expect(p.lowMidi <= p.comfortLow && p.comfortLow <= p.comfortHigh && p.comfortHigh <= p.highMidi).toBe(true);
  });

  it('the fake-mic tester (A2-E4, free sing G3-C4) now gets fits on the fixture songs', () => {
    const r = { ...range, low: 45, high: 64, comfortLow: 55, comfortHigh: 60 };
    const user = toUserRange(profileFromResult(r, classifyVoice(r), AT));
    const museRough = { low: 47.6, high: 68, p10: 51.5, p50: 58.1, p90: 64.5, tier: 'rough' as const, octaveConfidence: null };
    const starlight = { low: 47.2, high: 66.1, p10: 51, p50: 57.3, p90: 63, tier: 'measured' as const, octaveConfidence: null };
    expect(fitSong(user, museRough)).toMatchObject({ bucket: 'fitsIn', transpose: -2 });
    // Starlight's 18.9-key span vs a 19-key measured range: 0.1 key over at -2 -> a stretch, not a miss.
    expect(fitSong(user, starlight)).toMatchObject({ bucket: 'stretch', transpose: -2, cost: 0.05 });
    // Before the widening, both were outside (no badge).
    const narrow = { low: 45, high: 64, comfortLow: 55, comfortHigh: 60 };
    expect(fitSong(narrow, museRough).bucket).toBe('outside');
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
});
