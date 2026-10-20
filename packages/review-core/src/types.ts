// Ported from karaoke-gen frontend/lib/lyrics-review/types.ts (data model only; UI/edit-log types omitted).
// CorrectionData and metadata carry index signatures so unknown server keys round-trip.

// Singer id. 1 = Singer 1, 2 = Singer 2, 0 = Both. undefined = default (Singer 1).
export type SingerId = 0 | 1 | 2

export interface Word {
  id: string
  text: string
  start_time: number | null
  end_time: number | null
  confidence?: number
  created_during_correction?: boolean
  singer?: SingerId
  // AI auto-correct provenance (stamped when an AI suggestion is applied).
  // These drive the distinct purple highlight, the original-text bubble, and
  // the "estimated timing — needs scrutiny" marker in the review UI.
  /** This word was produced by an applied AI auto-correction → purple. */
  ai_corrected?: boolean
  /** Original transcription text for the whole correction span. Set on the
   *  FIRST word of the span only, so the bubble renders once per span. */
  original_text?: string
  /** Timing was guessed (one word split into N evenly-spaced words, or a word
   *  inserted) rather than inherited from a clean 1:1 replacement. */
  timing_estimated?: boolean
  /** Groups the words produced by one suggestion (= the suggestion id). Powers
   *  one-bubble-per-span rendering and inline undo. */
  correction_span_id?: string
}

export interface LyricsSegment {
  id: string
  text: string
  words: Word[]
  start_time: number | null
  end_time: number | null
  singer?: SingerId
}

export interface WordCorrection {
  id?: string
  handler: string
  original_word: string
  corrected_word: string
  segment_id?: string
  word_id: string
  corrected_word_id: string | null
  source: string
  confidence: number
  reason: string
  alternatives: Record<string, number>
  is_deletion: boolean
  split_index?: number | null
  split_total?: number | null
  reference_positions?: Record<string, number>
  length: number
}

export interface PhraseScore {
  phrase_type: string
  natural_break_score: number
  length_score: number
  total_score: number
}

export interface AnchorSequence {
  id: string
  transcribed_word_ids: string[]
  transcription_position: number
  reference_positions: Record<string, number>
  reference_word_ids: {
    [source: string]: string[]
  }
  confidence: number
  phrase_score?: PhraseScore
  total_score?: number
}

export interface GapSequence {
  id: string
  transcribed_word_ids: string[]
  transcription_position: number
  preceding_anchor_id: string | null
  following_anchor_id: string | null
  reference_word_ids: {
    [source: string]: string[]
  }
}

export interface ReferenceSource {
  segments: LyricsSegment[]
  metadata: {
    source: string
    track_name: string | null
    artist_names: string | null
    album_name: string | null
    duration_ms: number | null
    explicit: boolean | null
    language: string | null
    is_synced: boolean
    lyrics_provider: string
    lyrics_provider_id: string
    provider_metadata: Record<string, unknown>
  }
  source: string
}

export interface CorrectionStep {
  handler_name: string
  affected_word_ids: string[]
  affected_segment_ids: string[]
  corrections: WordCorrection[]
  segments_before: LyricsSegment[]
  segments_after: LyricsSegment[]
  created_word_ids: string[]
  deleted_word_ids: string[]
}

export interface CorrectionHandler {
  id: string
  name: string
  description: string
  enabled: boolean
}

export interface CorrectionData {
  [key: string]: unknown
  original_segments: LyricsSegment[]
  reference_lyrics: Record<string, ReferenceSource>
  anchor_sequences: AnchorSequence[]
  gap_sequences: GapSequence[]
  resized_segments: LyricsSegment[]
  corrections_made: number
  confidence: number
  corrections: WordCorrection[]
  corrected_segments: LyricsSegment[]
  metadata: {
    [key: string]: unknown
    anchor_sequences_count: number
    gap_sequences_count: number
    total_words: number
    correction_ratio: number
    audio_filepath?: string
    audio_hash?: string
    available_handlers?: CorrectionHandler[]
    enabled_handlers?: string[]
    artist?: string
    title?: string
    // Search terms for lyrics providers (title without any "(90% Tempo)" label)
    lyrics_artist?: string
    lyrics_title?: string
    // Server-side pre-apply marker (C2): when present, the backend already
    // applied the AI corrections before the review-ready notification, so the
    // review UI must NOT auto-run/auto-apply again. `suggestions` carries the
    // cached suggestions (typed loosely to avoid an import cycle; cast to
    // AiSuggestion[] at the call site).
    auto_approval?: {
      pre_applied?: boolean
      applied_suggestion_ids?: string[]
      rejected_suggestion_ids?: string[]
      suggestions?: unknown[]
      // Per-suggestion undo info (typed loosely, same reason as `suggestions`;
      // cast to Record<string, ServerSuggestionUndoInfo> at the call site).
      undo_info?: Record<string, unknown>
      applied_at?: string
    }
  }
  // Per-screen skip summary (C1): whether each review half is confidently
  // auto-resolved, so the UI can skip that screen. Absent on replay / old jobs.
  auto_approval?: {
    backing?: {
      verdict?: string | null
      confident?: boolean
      resolved_selection?: string | null
    }
    lyrics?: {
      verdict?: string | null
      confident?: boolean
    }
    custom_instrumental?: boolean
    verdict_present?: boolean
  }
  correction_steps: CorrectionStep[]
  word_id_map: Record<string, string>
  segment_id_map: Record<string, string>
  is_duet?: boolean
  // Instrumental selection data (added for combined review flow)
  instrumental_options?: InstrumentalOption[]
  backing_vocals_analysis?: BackingVocalsAnalysis | null
  // Sung stretches with no transcribed words (possible missing lyrics), from the
  // backend's vocal-gaps analysis (backend/services/auto_approval/vocal_gaps.py).
  // Absent/null when the job wasn't analyzed. Read-only: the review UI derives
  // which gaps are still open from the current segments, never mutates this.
  vocal_gaps?: VocalGapsResult | null
  // Replay mode (read-only re-open of a completed job via ?replay=true). Present
  // only in replay; carries the reviewer's ordered edit log for narration.
  replay?: {
    is_replay: boolean
    job_status: string
    instrumental_selection?: string | null
    edit_log?: unknown
    // "Post-AI, pre-human" lyrics (raw + accepted AI suggestions, before manual edits).
    // Present only when the reviewer made manual edits.
    post_ai_segments?: LyricsSegment[] | null
    has_manual_edits?: boolean
  }
}

/** One transcription gap where the lead vocal is singing (see vocal_gaps.py). */
export interface VocalGap {
  start: number
  end: number
  duration: number
  active_fraction: number
  longest_run_s: number
  /** source -> reference lines between the anchors either side of the gap */
  reference_lines?: Record<string, string[]>
  /** source -> synced reference lines (e.g. LRCLIB) timestamped inside the gap */
  synced_reference_lines?: Record<string, string[]>
  /** sung run long enough to be dropped lyrics (audio only — noisy) */
  suspect: boolean
  /** suspect AND reference lyrics place lines in this gap (reliable) */
  evidenced: boolean
}

export interface VocalGapsResult {
  version?: string
  gaps?: VocalGap[]
  suspect_count?: number
  evidenced_count?: number
  max_suspect_run_s?: number
  input_key?: string
  error?: string | null
}

/** Instrumental option from the combined review endpoint */
export interface InstrumentalOption {
  id: string // "clean" | "with_backing"
  label: string
  audio_url: string | null
}

/** Backing vocals analysis data */
export interface BackingVocalsAnalysis {
  has_audible_content: boolean
  total_duration_seconds: number
  audible_segments: {
    start_seconds: number
    end_seconds: number
    duration_seconds: number
  }[]
  recommended_selection: string // "clean" | "with_backing" | "review_needed"
  total_audible_duration_seconds: number
  audible_percentage: number
  silence_threshold_db: number
}

