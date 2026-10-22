import { AudioResultSchema, type AudioResult, type MatchKind, type MatchVerdict } from '@nomad/api-gen';
import { makeCheck, makeSearch } from '@nomad/api-kjbox';

import type { AudioSearcher } from '../../make/useAudioSearch';
import type { MatchJudgeFn } from '../../make/useMatchJudge';
import type { NomadNight } from '../nightStore';

const KINDS: MatchKind[] = ['none', 'cosmetic', 'content', 'ambiguous'];
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * The make flow's audio search through the box (spec §4.3): the box tops up tonight's free show credit, then runs
 * gen's search as the singer. Results are gen's own shape, passed through; anything that isn't a valid result is
 * dropped so the app's ranking (A.73) only sees well-formed rows.
 */
export const kjboxSearcher =
  (night: NomadNight): AudioSearcher =>
  async (artist, title) => {
    const r = await makeSearch(night.code, artist, title, night.nightId);
    const results = r.results.flatMap((raw) => {
      const parsed = AudioResultSchema.safeParse(raw);
      return parsed.success ? [parsed.data as AudioResult] : [];
    });
    return { sessionId: r.search_session_id ?? '', results };
  };

/**
 * gen's match judge through the box (it fails open with `none` on a gen hiccup). Normalised to gen's verdict shape:
 * an unknown kind from a newer gen means "nothing to change", as in the gen facade.
 */
export const kjboxJudge =
  (night: NomadNight): MatchJudgeFn =>
  async ({ artist, title, stage, audio_confidence_tier }) => {
    const v = await makeCheck(night.code, {
      artist,
      title,
      stage,
      night_id: night.nightId,
      ...(audio_confidence_tier ? { tier: audio_confidence_tier } : {}),
    });
    const alternatives = Array.isArray(v.alternatives)
      ? (v.alternatives as unknown[]).flatMap((a) => {
          const o = (a ?? {}) as Record<string, unknown>;
          return str(o.artist) && str(o.title) ? [{ artist: str(o.artist), title: str(o.title) }] : [];
        })
      : [];
    const verdict: MatchVerdict = {
      kind: KINDS.includes(v.kind as MatchKind) ? (v.kind as MatchKind) : 'none',
      confident: v.confident === true,
      canonical_artist: str(v.canonical_artist) || artist,
      canonical_title: str(v.canonical_title) || title,
      alternatives,
      engine: str(v.engine),
      reason: str(v.reason),
      needs_ai: v.needs_ai === true,
    };
    return verdict;
  };
