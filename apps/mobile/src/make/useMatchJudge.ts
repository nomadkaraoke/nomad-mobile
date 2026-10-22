import { matchJudge, type MatchKind, type MatchVerdict } from '@nomad/api-gen';
import type { ConfidenceTier } from '@nomad/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logEvent } from '../find/searchSession';
import type { MakeField, MakeIntent } from './intentStore';

export type Song = { artist: string; title: string };

/** Asks a judge pass: gen's own (default), or another service's (Tonight's goes through kjbox). */
export type MatchJudgeFn = typeof matchJudge;

/** The audio search, as the judge sees it. */
export type JudgeSearch = {
  /** The confidence tier of the latest results; null while searching. Only the first one counts. */
  tier: ConfidenceTier | null;
  /** Searches again for a corrected song. */
  reSearch(song: Song): void;
  /** True while the job is being created: a late verdict must not change the song or search again then. */
  busy?: () => boolean;
};

/** An applied correction: `from` is exactly what was showing before it, `to` what it showed after. */
export type Correction = { kind: 'cosmetic' | 'content'; from: Song; to: Song; active: boolean };

// gen AudioSourceStep: tier 3 is "weak" audio, a hint the title may be a typo.
const WEAK_TIER = 3;
/** Hard ceiling on how long the source gate waits for the judge (gen AudioSourceStep, verbatim). */
export const JUDGE_GATE_TIMEOUT_MS = 12000;

const FIELDS: MakeField[] = ['artist', 'title'];

/** A fast pass that settled it from the catalogue alone (a tidy, or already right): no AI needed. */
const isCatalogConfident = (v: MatchVerdict | null) =>
  !!v && !v.needs_ai && v.confident && (v.kind === 'cosmetic' || v.kind === 'none');

/** gen's rule for running the full pass after the fast one (null: the fast pass failed). */
const needsFull = (fast: MatchVerdict | null, tier: ConfidenceTier) =>
  !fast || fast.needs_ai || (isCatalogConfident(fast) && tier >= WEAK_TIER);

/**
 * Fields the judge must leave alone (Review Focus 5): ones the user changed away from a pre-filled song
 * (kjbox D10). A field typed into an empty form has no pre-fill to protect, so the judge may tidy or correct
 * it (that's what it's for). `canonical*` only say a pre-fill existed; they are never applied.
 */
function protectedFields(intent: MakeIntent): MakeField[] {
  const prefilled = { artist: intent.canonicalArtist, title: intent.canonicalTitle };
  return intent.editedFields.filter((f) => prefilled[f] !== undefined);
}

/**
 * gen's two-phase artist/title match judge for the make screen (gen AudioSourceStep, kjbox make.js; spec
 * §4.3, A103/A104):
 * - `fast` (catalogue only) fires on mount, in parallel with the audio search; a confident cosmetic tidy
 *   applies at once;
 * - once the first search has a tier, `full` runs only when fast was null, `needs_ai`, or a catalogue match
 *   landed on weak audio (tier 3);
 * - cosmetic: applied, no re-search; confident content: applied, re-searched only at tier 3; ambiguous (or an
 *   unsure content fix): "Did you mean", and accepting one always re-searches;
 * - undo/redo swap the metadata only;
 * - `gateOpen` stays false until the judge settles, or JUDGE_GATE_TIMEOUT_MS after the first search lands.
 *
 * At most two gen catalogue calls per make (the /api/catalog/* bucket is 20/min per user). `judge` replaces gen's
 * judge call (Tonight's make asks through kjbox).
 */
export function useMatchJudge(intent: MakeIntent | null, search: JudgeSearch, judge: MatchJudgeFn = matchJudge) {
  const judgeRef = useRef(judge);
  useEffect(() => {
    judgeRef.current = judge;
  });
  const [applied, setApplied] = useState<Song | null>(() =>
    intent ? { artist: intent.artist, title: intent.title } : null,
  );
  const [verdict, setVerdict] = useState<MatchVerdict | null>(null);
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [suggestions, setSuggestions] = useState<Song[]>([]);
  /** The fast pass's answer once it has one (`verdict` null: it failed). */
  const [fast, setFast] = useState<{ verdict: MatchVerdict | null } | null>(null);
  /** The first search's tier: the one the judge uses (a re-search never re-judges). */
  const [tier, setTier] = useState<ConfidenceTier | null>(null);
  const [fullDone, setFullDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Async passes read and write the current values through refs.
  const appliedRef = useRef(applied);
  const correctionRef = useRef(correction);
  const reSearchRef = useRef(search.reSearch);
  const busyRef = useRef(search.busy);
  useEffect(() => {
    reSearchRef.current = search.reSearch;
    busyRef.current = search.busy;
  });
  // gen's `cancelled` guard: a verdict landing after unmount must not apply or start a (~45 s) gen search.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /** The user undid, redid or picked a suggestion: a late verdict never overrides that choice. */
  const userChose = useRef(false);
  /** May a judge verdict that arrives now change anything? */
  const mayApply = useCallback(() => alive.current && !userChose.current && !busyRef.current?.(), []);

  const show = useCallback((song: Song, next: Correction | null) => {
    appliedRef.current = song;
    correctionRef.current = next;
    setApplied(song);
    setCorrection(next);
  }, []);

  const locked = useRef<MakeField[]>(intent ? protectedFields(intent) : []);

  /** Applies a correction to every unprotected field; `force` (the user chose it) applies it all. */
  const applyCorrection = useCallback(
    (kind: Correction['kind'], to: Song, reSearch: boolean, force = false) => {
      const from = appliedRef.current;
      if (!from || !to.artist || !to.title) return;
      const next = { ...from };
      for (const f of FIELDS) if (force || !locked.current.includes(f)) next[f] = to[f];
      if (next.artist === from.artist && next.title === from.title) return;
      show(next, { kind, from, to: next, active: true });
      if (reSearch) reSearchRef.current(next);
    },
    [show],
  );

  // Phase 1: the fast pass, once, on mount (an intent arriving after sign-in counts as the mount).
  const fastStarted = useRef(false);
  useEffect(() => {
    if (!intent || fastStarted.current) return;
    fastStarted.current = true;
    locked.current = protectedFields(intent);
    show({ artist: intent.artist, title: intent.title }, null);
    judgeRef.current({ artist: intent.artist, title: intent.title, stage: 'fast' })
      .then((v) => {
        if (mayApply() && v.kind === 'cosmetic' && v.confident && !v.needs_ai) {
          setVerdict(v);
          applyCorrection('cosmetic', { artist: v.canonical_artist, title: v.canonical_title }, false);
        }
        setFast({ verdict: v });
      })
      .catch(() => setFast({ verdict: null }));
  }, [intent, show, applyCorrection, mayApply]);

  // The first search's tier is the judge's; it also starts the gate's safety timer.
  const searchTier = search.tier;
  useEffect(() => {
    if (searchTier !== null && tier === null && fastStarted.current) setTier(searchTier);
  }, [searchTier, tier]);
  useEffect(() => {
    if (tier === null) return;
    const timer = setTimeout(() => setTimedOut(true), JUDGE_GATE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [tier]);

  // Phase 2: with the fast answer and the tier known, the full pass if needed. Always settles.
  const wantFull = fast !== null && tier !== null && needsFull(fast.verdict, tier);
  const fullStarted = useRef(false);
  useEffect(() => {
    if (!wantFull || tier === null || fullStarted.current) return;
    fullStarted.current = true;
    const song = appliedRef.current ?? { artist: '', title: '' };
    const t = tier;
    judgeRef.current({ ...song, stage: 'full', audio_confidence_tier: t })
      .then((v) => {
        if (!mayApply()) return;
        setVerdict(v);
        const to = { artist: v.canonical_artist, title: v.canonical_title };
        if (v.kind === 'cosmetic' && v.confident) applyCorrection('cosmetic', to, false);
        else if (v.kind === 'content' && v.confident) applyCorrection('content', to, t >= WEAK_TIER);
        else if (v.kind === 'ambiguous' || v.kind === 'content') {
          setSuggestions([to, ...v.alternatives].filter((o) => o.artist && o.title));
        }
      })
      // Matching is a nice-to-have: on failure the user keeps what they typed.
      .catch(() => {})
      .finally(() => setFullDone(true));
  }, [wantFull, tier, applyCorrection, mayApply]);

  const settled = fast !== null && tier !== null && (!wantFull || fullDone);

  const undo = useCallback(() => {
    const c = correctionRef.current;
    if (!c?.active) return;
    userChose.current = true;
    show(c.from, { ...c, active: false });
    logEvent('keep_typed', { where: 'make', kind: c.kind });
  }, [show]);

  const redo = useCallback(() => {
    const c = correctionRef.current;
    if (!c || c.active) return;
    userChose.current = true;
    show(c.to, { ...c, active: true });
    logEvent('reapply_tidy', { where: 'make', kind: c.kind });
  }, [show]);

  const acceptAlternative = useCallback(
    (i: number) => {
      const pick = suggestions[i];
      if (!pick) return;
      setSuggestions([]);
      userChose.current = true;
      // Like gen: the accepted suggestion becomes a confident content correction.
      setVerdict({
        kind: 'content',
        confident: true,
        canonical_artist: pick.artist,
        canonical_title: pick.title,
        alternatives: [],
        engine: 'ai',
        reason: '',
        needs_ai: false,
      });
      logEvent('pick_candidate', { where: 'make', index: i });
      // The user chose it: it replaces both fields, and the audio is searched again for it.
      applyCorrection('content', pick, true, true);
    },
    [suggestions, applyCorrection],
  );

  return {
    state: settled ? ('settled' as const) : ('pending' as const),
    /** What the screen shows and the job is made with (null without an intent). */
    applied,
    verdict,
    kind: (verdict?.kind ?? null) as MatchKind | null,
    correction,
    /** "Did you mean" options (empty when there's nothing to ask). */
    suggestions,
    undo,
    redo,
    acceptAlternative,
    gateOpen: settled || timedOut,
  };
}
