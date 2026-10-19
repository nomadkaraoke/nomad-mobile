// Which of Discover's search outcomes (spec §4.1) a search answer shows. Pure: the screen renders it.
import type { Identification, ResolveResponse, SongGroup, SongRef } from '@nomad/api-decide';
import { sameSong } from '@nomad/core';

/** How the identified song differs from what was typed (decide `identify_kind`); `null` = nothing to announce. */
export type Announce = { kind: 'cosmetic' | 'content'; typed: string } | null;

export type Outcome =
  /** Confident (or picked): the song you mean, its versions when it has a group, then the other groups. */
  | { kind: 'song'; song: SongRef; announce: Announce; group: SongGroup | null; others: SongGroup[]; canNotIt: boolean }
  /** Confident, no karaoke version (the index's own flag says so, and no group is that song). */
  | { kind: 'missing'; song: SongRef; others: SongGroup[] }
  /** Not sure: candidate chips over the karaoke results. */
  | { kind: 'choose'; heading: 'whichOne' | 'didYouMean'; candidates: SongRef[]; groups: SongGroup[] }
  /** Just the karaoke results (nothing identified, or the user kept what they typed). */
  | { kind: 'list'; groups: SongGroup[] };

/** The user's choices on the current answer; they reset with each new query. */
export type Choice = { keepTyped: boolean; notIt: boolean; picked: number | null };
export const NO_CHOICE: Choice = { keepTyped: false, notIt: false, picked: null };

const without = (groups: SongGroup[], song: SongRef) => groups.filter((g) => !sameSong(g, song));

function songOutcome(song: SongRef, announce: Announce, groups: SongGroup[], canNotIt: boolean): Outcome {
  const group = groups.find((g) => sameSong(g, song)) ?? null;
  const others = without(groups, song);
  // kjbox B108: only the index's karaoke flag may claim "no karaoke version yet" ("Killers" vs "The Killers").
  if (!group && song.karaoke === false) return { kind: 'missing', song, others };
  return { kind: 'song', song, announce, group, others, canNotIt };
}

/** Candidates other than the song already shown. */
const othersThan = (song: SongRef, candidates: SongRef[] | undefined) => (candidates ?? []).filter((c) => !sameSong(c, song));

function chosen(base: Outcome, choice: Choice): Outcome {
  if (base.kind === 'choose' && choice.picked !== null) {
    const song = base.candidates[choice.picked];
    if (song) return songOutcome(song, null, base.groups, false);
  }
  return base;
}

function announced(kind: string | null | undefined, typed: string): Announce {
  return kind === 'cosmetic' || kind === 'content' ? { kind, typed } : null;
}

/**
 * A corrected song (cards, versions) / alternatives (chips) / nothing, for a Gemini resolve answer: the
 * cloud's fallback when it found nothing, or "Describe it".
 */
function resolveOutcome(r: ResolveResponse, typed: string, choice: Choice): Outcome | null {
  const groups = r.groups ?? [];
  if (r.corrected) {
    const song = r.corrected;
    if (choice.keepTyped) return { kind: 'list', groups: without(groups, song) };
    if (choice.notIt) {
      const alts = othersThan(song, r.alternatives);
      return chosen(alts.length ? { kind: 'choose', heading: 'didYouMean', candidates: alts, groups } : { kind: 'list', groups }, choice);
    }
    return songOutcome(song, announced(r.kind ?? 'content', r.typed ?? typed), groups, true);
  }
  if (r.alternatives?.length) return chosen({ kind: 'choose', heading: 'didYouMean', candidates: r.alternatives, groups }, choice);
  return null;
}

export function searchOutcome(
  ident: Identification | null,
  groups: SongGroup[],
  resolve: ResolveResponse | null,
  query: string,
  choice: Choice,
): Outcome {
  const best = ident?.best ?? null;
  if (ident?.status === 'confident' && best) {
    if (choice.keepTyped) return { kind: 'list', groups: without(groups, best) };
    if (choice.notIt) {
      const candidates = othersThan(best, ident.candidates);
      return chosen(candidates.length ? { kind: 'choose', heading: 'whichOne', candidates, groups } : { kind: 'list', groups }, choice);
    }
    const announce = announced(ident.kind, query);
    return songOutcome(best, announce, groups, announce !== null || othersThan(best, ident.candidates).length > 0);
  }
  if (ident?.status === 'candidates' && ident.candidates?.length) {
    return chosen({ kind: 'choose', heading: 'whichOne', candidates: ident.candidates, groups }, choice);
  }
  if (resolve) {
    const r = resolveOutcome(resolve, query, choice);
    if (r) return r;
  }
  return { kind: 'list', groups };
}

/** "Describe it": the resolve answer for the description, or null when it found nothing. */
export function describeOutcome(r: ResolveResponse, text: string, choice: Choice): Outcome | null {
  return resolveOutcome(r, text, choice);
}

/** The make offer an outcome shows: the missing card, the sticky bar (never with a confident song), or none. */
export function makeOfferWhere(o: Outcome): 'missing_card' | 'make_bar' | null {
  if (o.kind === 'missing') return 'missing_card';
  if (o.kind === 'choose' || o.kind === 'list') return 'make_bar';
  return null;
}
