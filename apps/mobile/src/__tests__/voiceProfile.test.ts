// Local voice profile (Phase 3c Task 18a): mappers from a mic result / self-report, the decide body, MMKV store.
import { classifyVoice, summarizeRange, type RangeSummary } from '@nomad/core';
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
  it('copies the range and classification, method mic', () => {
    const c = classifyVoice(range);
    const p = profileFromResult(range, c, AT);
    expect(p).toEqual({
      lowMidi: 45,
      highMidi: 64,
      comfortLow: 50,
      comfortHigh: 59,
      voiceType: c.type,
      voiceTypeBetween: c.between,
      register: null,
      confidence: c.confidence,
      method: 'mic',
      measuredAt: AT,
    });
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

  it('loadVoice() reads a mic profile back', () => {
    const held = [45, 50, 55, 59, 64].map((note, i) => ({ note, midi: note, start: i, end: i + 1 }));
    const r = summarizeRange(held, [])!;
    const p = profileFromResult(r, classifyVoice(r), AT);
    appStorage.set(VOICE_STORAGE_KEY, JSON.stringify({ profile: p, pending: false }));
    expect(loadVoice()).toEqual({ profile: p, pending: false });
  });
});
