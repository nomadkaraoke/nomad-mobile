// The singer's voice profile on this phone (Phase 3c): the latest mic result or self-report, kept until decide has
// it. 18b's useSaveVoiceProfile / useFlushPendingVoice PUT `toVoiceProfileIn(profile)` while `pending` is true.
import {
  selfReportProfile,
  VOICE_TYPES,
  type Classification,
  type RangeSummary,
  type Register,
  type UserVoiceRange,
  type VoiceType,
} from '@nomad/core';
import { create } from 'zustand';

import { appStorage } from '../storage';

export const VOICE_STORAGE_KEY = 'voice.profile.v1';

export type VoiceConfidence = 'low' | 'medium' | 'high';
/** `session`: measured by decide's voice sessions (decide v0.28, Phase 3d); the phone only adopts it, never PUTs one. */
export type VoiceMethod = 'mic' | 'self' | 'session';

/** decide's voice profile, camelCase. */
export type LocalVoiceProfile = {
  lowMidi: number;
  highMidi: number;
  comfortLow: number;
  comfortHigh: number;
  voiceType: VoiceType | null;
  voiceTypeBetween: VoiceType | null;
  register: Register | null;
  confidence: VoiceConfidence;
  method: VoiceMethod;
  /** ISO 8601. */
  measuredAt: string;
  /** Session profiles: how many attempts carried evidence, and the session. Absent on the phone's own mic/self. */
  evidenceCount?: number | null;
  sessionId?: string | null;
  /** The top note the singer said was falsetto (mic test; kept out of lowMidi..highMidi). Absent when none. */
  falsettoHigh?: number;
};

/** The body of decide's `PUT /api/my/voice` (`VoiceProfilePutIn`, extra="forbid": no other keys). */
export type VoiceProfileInBody = {
  low_midi: number;
  high_midi: number;
  comfort_low: number;
  comfort_high: number;
  voice_type: VoiceType | null;
  voice_type_between: VoiceType | null;
  register: Register | null;
  confidence: VoiceConfidence;
  /** The public PUT rejects `session` (422). */
  method: 'mic' | 'self';
  measured_at: string;
  /** decide ≥ v0.33 (an older decide answers 422 extra_forbidden: sendPendingVoice then resends without it). */
  falsetto_high?: number;
};

/**
 * The narrowest comfortable band a mic result is saved with, in keys counted inclusively (so the semitones between
 * its edges are one fewer). A 30 s free sing measures a P10–P90 of only about 5–7 keys, and a band that narrow made
 * too few songs fit (a self-report gets 14). Widening around the measured centre keeps fit badges meaningful; the old
 * rule stretched the edges to within 2 keys of the range, which made comfort ≈ range so nearly every song "fit".
 */
export const MIN_COMFORT_KEYS = 11;

/** `comfortLow`..`comfortHigh` widened symmetrically to MIN_COMFORT_KEYS inside [low, high]; wider bands are untouched. */
function widenComfort(range: RangeSummary): { comfortLow: number; comfortHigh: number } {
  const { low, high, comfortLow, comfortHigh } = range;
  const want = Math.min(MIN_COMFORT_KEYS - 1, high - low); // semitones between the edges
  const extra = want - (comfortHigh - comfortLow);
  if (extra <= 0) return { comfortLow, comfortHigh };
  let lo = comfortLow - Math.floor(extra / 2);
  let hi = comfortHigh + Math.ceil(extra / 2);
  // At an edge of the range, move the overhang to the other side so the width is kept.
  if (lo < low) {
    hi += low - lo;
    lo = low;
  }
  if (hi > high) {
    lo -= hi - high;
    hi = high;
  }
  return { comfortLow: Math.max(low, lo), comfortHigh: Math.min(high, hi) };
}

/**
 * A mic result as the profile to save. The free-sing comfort is kept, widened symmetrically around its centre to at
 * least MIN_COMFORT_KEYS (clamped to the range). The voice type still comes from the free-sing centre (`c`,
 * classified upstream). The result screen shows this same profile, so what is shown is what is saved.
 */
export function profileFromResult(
  range: RangeSummary,
  c: Classification,
  measuredAt: string,
  falsettoHigh?: number | null,
): LocalVoiceProfile {
  return {
    lowMidi: range.low,
    highMidi: range.high,
    ...widenComfort(range),
    voiceType: c.type,
    voiceTypeBetween: c.between,
    register: null,
    confidence: c.confidence,
    method: 'mic',
    measuredAt,
    ...(falsettoHigh != null && { falsettoHigh }),
  };
}

export function profileFromSelfReport(choice: VoiceType | Register, measuredAt: string): LocalVoiceProfile {
  const p = selfReportProfile(choice);
  return {
    lowMidi: p.low,
    highMidi: p.high,
    comfortLow: p.comfortLow,
    comfortHigh: p.comfortHigh,
    voiceType: p.voiceType,
    voiceTypeBetween: null,
    register: p.register,
    confidence: 'low',
    method: 'self',
    measuredAt,
  };
}

/** The PUT body of a mic/self profile. Throws for a `session` profile: decide writes those itself. */
export function toVoiceProfileIn(p: LocalVoiceProfile): VoiceProfileInBody {
  if (p.method === 'session') throw new Error('toVoiceProfileIn: session profiles are written by decide only');
  return {
    low_midi: p.lowMidi,
    high_midi: p.highMidi,
    comfort_low: p.comfortLow,
    comfort_high: p.comfortHigh,
    voice_type: p.voiceType,
    voice_type_between: p.voiceTypeBetween,
    register: p.register,
    confidence: p.confidence,
    method: p.method,
    measured_at: p.measuredAt,
    ...(p.falsettoHigh !== undefined && { falsetto_high: p.falsettoHigh }),
  };
}

/** What `fitSong` needs. */
export function toUserRange(p: LocalVoiceProfile): UserVoiceRange {
  return { low: p.lowMidi, high: p.highMidi, comfortLow: p.comfortLow, comfortHigh: p.comfortHigh };
}

const TYPES: readonly string[] = VOICE_TYPES.map((v) => v.type);
const REGISTERS: readonly string[] = ['lower', 'middle', 'higher'];
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const oneOrNull = (v: unknown, allowed: readonly string[]) => v === null || (typeof v === 'string' && allowed.includes(v));

/** A stored profile, or null when it isn't one we wrote. */
function parseProfile(raw: unknown): LocalVoiceProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const ok =
    int(o.lowMidi) &&
    int(o.highMidi) &&
    int(o.comfortLow) &&
    int(o.comfortHigh) &&
    oneOrNull(o.voiceType, TYPES) &&
    oneOrNull(o.voiceTypeBetween, TYPES) &&
    oneOrNull(o.register, REGISTERS) &&
    (o.confidence === 'low' || o.confidence === 'medium' || o.confidence === 'high') &&
    (o.method === 'mic' || o.method === 'self' || o.method === 'session') &&
    typeof o.measuredAt === 'string' &&
    (o.evidenceCount === undefined || o.evidenceCount === null || (int(o.evidenceCount) && o.evidenceCount >= 0)) &&
    (o.sessionId === undefined || o.sessionId === null || typeof o.sessionId === 'string') &&
    (o.falsettoHigh === undefined || (int(o.falsettoHigh) && o.falsettoHigh >= (o.lowMidi as number) && o.falsettoHigh <= 96));
  if (!ok) return null;
  // decide's rule: low ≤ comfortLow ≤ comfortHigh ≤ high.
  const { lowMidi, highMidi, comfortLow, comfortHigh } = o as LocalVoiceProfile;
  if (!(lowMidi <= comfortLow && comfortLow <= comfortHigh && comfortHigh <= highMidi)) return null;
  return toLocal(o as LocalVoiceProfile);
}

/** Only the profile's own fields (the session ones only when present). */
const toLocal = (p: LocalVoiceProfile): LocalVoiceProfile => ({
  lowMidi: p.lowMidi,
  highMidi: p.highMidi,
  comfortLow: p.comfortLow,
  comfortHigh: p.comfortHigh,
  voiceType: p.voiceType,
  voiceTypeBetween: p.voiceTypeBetween,
  register: p.register,
  confidence: p.confidence,
  method: p.method,
  measuredAt: p.measuredAt,
  ...(p.evidenceCount !== undefined && { evidenceCount: p.evidenceCount }),
  ...(p.sessionId !== undefined && { sessionId: p.sessionId }),
  ...(p.falsettoHigh !== undefined && { falsettoHigh: p.falsettoHigh }),
});

/**
 * `rejected`: decide refused this profile for good (400/422), so decide having none is expected and is not "removed
 * on another phone". Present only when true, so older stored copies read back unchanged.
 */
type Persisted = { profile: LocalVoiceProfile | null; pending: boolean; rejected?: true };
const EMPTY: Persisted = { profile: null, pending: false };

/** This phone's copy, or empty when there is none (or it is unreadable, which is then removed). */
export function loadVoice(): Persisted {
  try {
    const raw = appStorage.getString(VOICE_STORAGE_KEY);
    if (raw === undefined) return EMPTY;
    const v = JSON.parse(raw) as { profile?: unknown; pending?: unknown; rejected?: unknown };
    const profile = parseProfile(v?.profile);
    if (profile) {
      const pending = v.pending === true;
      return !pending && v.rejected === true ? { profile, pending, rejected: true } : { profile, pending };
    }
  } catch {
    // fall through: unreadable
  }
  appStorage.remove(VOICE_STORAGE_KEY);
  return EMPTY;
}

type VoiceStore = Persisted & {
  /** A new measurement or pick: replaces the profile and waits to be sent to decide. */
  save(profile: LocalVoiceProfile): void;
  /** decide has the profile measured at `measuredAt`; a newer local one stays pending. */
  markSynced(measuredAt: string): void;
  /** decide refused this measurement for good (400/422): keep it for badges but stop retrying it. */
  markRejected(measuredAt: string): void;
  /** decide's copy is newer than ours: it replaces the profile and nothing is pending. */
  adopt(profile: LocalVoiceProfile): void;
  clear(): void;
};

const persist = (s: Persisted) => appStorage.set(VOICE_STORAGE_KEY, JSON.stringify(s));

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  ...loadVoice(),
  save(profile) {
    const next = { profile: toLocal(profile), pending: true };
    persist(next);
    set({ ...next, rejected: undefined });
  },
  markSynced(measuredAt) {
    const { profile } = get();
    if (!profile || profile.measuredAt !== measuredAt) return;
    const next = { profile, pending: false };
    persist(next);
    set({ ...next, rejected: undefined });
  },
  markRejected(measuredAt) {
    const { profile } = get();
    if (!profile || profile.measuredAt !== measuredAt) return;
    const next = { profile, pending: false, rejected: true as const };
    persist(next);
    set(next);
  },
  adopt(profile) {
    const next = { profile: toLocal(profile), pending: false };
    persist(next);
    set({ ...next, rejected: undefined });
  },
  clear() {
    appStorage.remove(VOICE_STORAGE_KEY);
    set({ ...EMPTY, rejected: undefined });
  },
}));
