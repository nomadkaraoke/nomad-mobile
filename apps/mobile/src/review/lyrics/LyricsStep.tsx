import { Ionicons } from '@expo/vector-icons';
import { useTranslations } from '@nomad/i18n';
import {
  activeLine,
  collectIssues,
  countUntimedWords,
  deleteLine,
  firstUntimed,
  insertGapLines,
  mergeLines,
  nextTimedStart,
  openVocalGaps,
  prevTimedEnd,
  setLineSinger,
  splitLine,
  type CorrectionData,
  type LyricsSegment,
  type OpenVocalGap,
  type SingerId,
  type VocalGap,
} from '@nomad/review-core';
import { colors, List, type ListHandle, StartText, type WaveformMarker } from '@nomad/ui';
import { useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { Pressable, View } from 'react-native';

import type { ReviewPlayer } from '../audio/useReviewPlayer';
import { directionalIcon } from '../directionalIcon';
import { ReviewStoreContext, useReviewStore } from '../store';
import { GapCallout } from './GapCallout';
import { IssuesBar } from './IssuesBar';
import { LineRow } from './LineRow';
import type { LineTool } from './LineToolbar';
import { PlayerBar } from './PlayerBar';
import type { VocalsPeaks } from './useVocalsPeaks';

/** Text the screen must collect (Edit text sheet) before lines can be inserted: no wordless lines (Ruling K). */
export type TextRequest = { kind: 'insertAfter'; segment: number } | { kind: 'gap'; gap: VocalGap };

/** What the screen can ask of the step (the step header's "Finish" while words are untimed). */
export type LyricsStepHandle = { jumpToFirstUntimed(): void };

export type LyricsStepProps = {
  ref?: Ref<LyricsStepHandle>;
  player: ReviewPlayer;
  peaks: VocalsPeaks;
  vocalsReady: boolean;
  onEditLine: (segment: number) => void;
  onResync: (segment: number) => void;
  onNudge: (segment: number) => void;
  onWordPress: (segment: number, word: number) => void;
  onRequestText: (request: TextRequest) => void;
  /** "Lyrics look good": on to Finish. */
  onNext: () => void;
};

type Item = { type: 'line'; index: number; segment: LyricsSegment } | { type: 'gap'; k: number; open: OpenVocalGap };

/** A tapped line plays from this long before its start. */
const LINE_LEAD_S = 0.5;
/** Stepping to an issue plays from this long before it. */
const ISSUE_LEAD_S = 1;
const GAP_TAIL_S = 0.5;
/** Where a followed or jumped-to row lands (fraction of the list height from the top). */
const VIEW_POSITION = 0.3;
/** After a jump (issue, line tap, CTA) auto-follow holds off this long, so it doesn't yank the list back. */
const FOLLOW_HOLD_MS = 1500;
const NEXT_SINGER: Record<SingerId, SingerId> = { 1: 2, 2: 0, 0: 1 };

/** Lines in order, with each open vocal gap's callout just before the first line that starts after it. */
function buildItems(segments: readonly LyricsSegment[], gaps: readonly OpenVocalGap[]) {
  const before = new Map<number, number[]>();
  gaps.forEach((g, k) => {
    const idx = segments.findIndex((s) => s.words.some((w) => w.start_time !== null && w.start_time >= g.gap.start));
    const at = idx === -1 ? segments.length : idx;
    before.set(at, [...(before.get(at) ?? []), k]);
  });
  const items: Item[] = [];
  const lineItem: number[] = [];
  const gapItem: number[] = [];
  const pushGaps = (at: number) =>
    (before.get(at) ?? []).forEach((k) => {
      gapItem[k] = items.length;
      items.push({ type: 'gap', k, open: gaps[k]! });
    });
  segments.forEach((segment, index) => {
    pushGaps(index);
    lineItem[index] = items.length;
    items.push({ type: 'line', index, segment });
  });
  pushGaps(segments.length);
  return { items, lineItem, gapItem };
}

/** The line's playable span; an untimed line borrows its timed neighbours' edges. */
function lineRange(segments: readonly LyricsSegment[], i: number): { start: number; end: number } {
  const seg = segments[i]!;
  const start = seg.start_time ?? prevTimedEnd(segments, i) ?? 0;
  const end = seg.end_time ?? nextTimedStart(segments, i) ?? start + 5;
  return { start, end: Math.max(end, start) };
}

/** Split before the word under the playhead when it is inside the line, else in the middle. */
function splitPoint(seg: LyricsSegment, t: number): number {
  const n = seg.words.length;
  if (seg.start_time !== null && seg.end_time !== null && t > seg.start_time && t < seg.end_time) {
    const k = seg.words.findIndex((w) => w.start_time !== null && w.start_time > t);
    if (k > 0) return k;
  }
  return Math.max(1, Math.floor(n / 2));
}

/** Words of unmatched transcription stretches, shown orange only when the job has no reference lyrics. */
function unreferencedWords(source: CorrectionData): ReadonlySet<string> | undefined {
  if (Object.keys(source.reference_lyrics ?? {}).length > 0) return undefined;
  const ids = (source.gap_sequences ?? []).flatMap((g) => g.transcribed_word_ids ?? []);
  return ids.length ? new Set(ids) : undefined;
}

/** Lyrics step (spec §4.2): listen along, check the flagged spots, fix lines, then "Lyrics look good". */
export function LyricsStep({ ref, ...props }: LyricsStepProps) {
  const { player, peaks, vocalsReady, onNext } = props;
  const t = useTranslations('review');
  const store = useContext(ReviewStoreContext)!;
  const doc = useReviewStore((s) => s.doc);
  const apply = useReviewStore((s) => s.apply);
  const segments = doc.segments;
  const listRef = useRef<ListHandle>(null);
  const [selectedRaw, setSelected] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [cursorRaw, setCursor] = useState(-1);

  const gaps = useMemo(() => openVocalGaps(doc), [doc]);
  const issues = useMemo(() => collectIssues(doc), [doc]);
  const untimed = useMemo(() => countUntimedWords(segments), [segments]);
  const { items, lineItem, gapItem } = useMemo(() => buildItems(segments, gaps), [segments, gaps]);
  const gapWordIds = useMemo(() => unreferencedWords(doc.source), [doc.source]);

  const selected = selectedRaw !== null && selectedRaw < segments.length ? selectedRaw : null;
  const cursor = cursorRaw < issues.length ? cursorRaw : -1;
  const position = player.position;
  const active = player.playing || position > 0 ? activeLine(segments, position) : -1;

  const scrollTo = useCallback((item: number | undefined) => {
    if (item !== undefined) listRef.current?.scrollToIndex(item, { animated: true, viewPosition: VIEW_POSITION });
  }, []);

  // Newest values for the row callbacks (stable, so memoised rows don't re-render per tick) and for
  // auto-follow. Declared before the follow effect so that effect reads this render's values.
  const latestRef = useRef({ props, gaps, follow, lineItem });
  useEffect(() => {
    latestRef.current = { props, gaps, follow, lineItem };
  });
  const holdFollowUntilRef = useRef(0);
  const holdFollow = useCallback(() => {
    holdFollowUntilRef.current = Date.now() + FOLLOW_HOLD_MS;
  }, []);
  const jumpTo = useCallback(
    (item: number | undefined) => {
      holdFollow();
      scrollTo(item);
    },
    [holdFollow, scrollTo],
  );

  // Auto-follow the playing line, only when the line changes, until the person scrolls by hand.
  useEffect(() => {
    const { follow: following, props: p, lineItem: items } = latestRef.current;
    if (!following || !p.player.playing || active < 0 || Date.now() < holdFollowUntilRef.current) return;
    scrollTo(items[active]);
  }, [active, scrollTo]);

  const jumpToFirstUntimed = useCallback(() => {
    const first = firstUntimed(store.getState().doc.segments);
    if (!first) return;
    setSelected(first.segment);
    jumpTo(latestRef.current.lineItem[first.segment]);
  }, [store, jumpTo]);
  useImperativeHandle(ref, () => ({ jumpToFirstUntimed }), [jumpToFirstUntimed]);

  const onPressLine = useCallback(
    (i: number) => {
      const segs = store.getState().doc.segments;
      if (!segs[i]) return;
      holdFollow();
      setSelected(i);
      const { start, end } = lineRange(segs, i);
      latestRef.current.props.player.playRange(Math.max(0, start - LINE_LEAD_S), end);
    },
    [store, holdFollow],
  );

  const onWordPress = useCallback((i: number, j: number) => latestRef.current.props.onWordPress(i, j), []);

  const onSinger = useCallback(
    (i: number) => apply((d) => (d.segments[i] ? setLineSinger(d, i, NEXT_SINGER[d.segments[i]!.singer ?? 1]) : d)),
    [apply],
  );

  const onTool = useCallback(
    (tool: LineTool, i: number) => {
      const p = latestRef.current.props;
      switch (tool) {
        case 'play':
          return onPressLine(i);
        case 'edit':
          return p.onEditLine(i);
        case 'resync':
          return p.onResync(i);
        case 'nudge':
          return p.onNudge(i);
        case 'split':
          return apply((d) => (d.segments[i] ? splitLine(d, i, splitPoint(d.segments[i]!, p.player.position)) : d));
        case 'merge':
          return apply((d) => mergeLines(d, i));
        case 'insert':
          return p.onRequestText({ kind: 'insertAfter', segment: i });
        case 'delete':
          apply((d) => deleteLine(d, i));
          return setSelected(null);
      }
    },
    [apply, onPressLine],
  );

  const onGapPlay = useCallback(
    (k: number) => {
      const g = latestRef.current.gaps[k]?.gap;
      if (g) latestRef.current.props.player.playRange(Math.max(0, g.start - ISSUE_LEAD_S), g.end + GAP_TAIL_S);
    },
    [],
  );

  const onGapInsert = useCallback(
    (k: number) => {
      const g = latestRef.current.gaps[k]?.gap;
      if (!g) return;
      if (insertGapLines(store.getState().doc, g).needsText) {
        latestRef.current.props.onRequestText({ kind: 'gap', gap: g });
        return;
      }
      let at = -1;
      apply((d) => {
        const r = insertGapLines(d, g);
        at = r.insertedAt;
        return r.doc;
      });
      if (at >= 0) setSelected(at);
    },
    [apply, store],
  );

  const onGapSync = useCallback(
    (k: number) => {
      const s = latestRef.current.gaps[k]?.pendingSegment;
      if (s !== null && s !== undefined) latestRef.current.props.onResync(s);
    },
    [],
  );

  const onStepIssue = (k: number) => {
    const issue = issues[k];
    if (!issue) return;
    setCursor(k);
    setSelected(issue.segment);
    let item = lineItem[issue.segment];
    let end = segments[issue.segment]?.end_time ?? issue.time + 4;
    if (issue.kind === 'vocal_gap') {
      const gk = gaps.findIndex((g) => g.gap.start === issue.time);
      if (gk >= 0) {
        item = gapItem[gk];
        end = gaps[gk]!.gap.end;
      }
    }
    jumpTo(item);
    player.playRange(Math.max(0, issue.time - ISSUE_LEAD_S), Math.max(end, issue.time + ISSUE_LEAD_S));
  };

  const onCta = () => {
    if (untimed === 0) return onNext();
    jumpToFirstUntimed();
  };

  const onFollow = () => {
    setFollow(true);
    holdFollowUntilRef.current = 0;
    if (active >= 0) scrollTo(lineItem[active]);
  };

  const duration = player.duration > 0 ? player.duration : peaks.duration;
  const markers = useMemo<WaveformMarker[]>(() => {
    if (duration <= 0) return [];
    const gapMarks = gaps.map(({ gap }) => ({ from: gap.start / duration, to: gap.end / duration, color: colors.orange }));
    const untimedMarks = issues
      .filter((i) => i.kind === 'untimed')
      .map((i) => ({ from: i.time / duration, to: (i.time + 0.5) / duration, color: colors.danger }));
    return [...gapMarks, ...untimedMarks];
  }, [duration, gaps, issues]);

  const activeTime = active >= 0 ? position : undefined;
  const extraData = useMemo(() => ({ active, selected, activeTime, isDuet: doc.isDuet }), [active, selected, activeTime, doc.isDuet]);
  const last = segments.length - 1;

  const renderItem = (item: Item) =>
    item.type === 'gap' ? (
      <GapCallout k={item.k} open={item.open} onPlay={onGapPlay} onInsert={onGapInsert} onSync={onGapSync} />
    ) : (
      <LineRow
        index={item.index}
        segment={item.segment}
        active={item.index === active}
        selected={item.index === selected}
        time={item.index === active ? activeTime : undefined}
        isDuet={doc.isDuet}
        isLast={item.index === last}
        gapWordIds={gapWordIds}
        onPressLine={onPressLine}
        onWordPress={onWordPress}
        onSinger={onSinger}
        onTool={onTool}
      />
    );

  const blocked = untimed > 0;
  const ctaLabel = blocked ? t('lyrics.needTiming', { count: untimed }) : t('lyrics.next');

  return (
    <View testID="review-step-lyrics" className="flex-1">
      <IssuesBar issues={issues} cursor={cursor} onStep={onStepIssue} />
      <View className="flex-1">
        <List
          ref={listRef}
          testID="review-lines"
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => (item.type === 'line' ? `line-${item.segment.id}` : `gap-${item.open.gap.start}`)}
          getItemType={(item) => item.type}
          extraData={extraData}
          onScrollBeginDrag={() => setFollow(false)}
          ListEmptyComponent={<StartText className="p-6 text-center text-muted">{t('lyrics.empty')}</StartText>}
          // Room below the last row for the floating Follow pill: it covered the last gap callout's buttons.
          ListFooterComponent={<View testID="review-lines-footer" className="h-20" />}
        />
        {!follow ? (
          <Pressable
            testID="review-player-follow"
            accessibilityRole="button"
            accessibilityLabel={t('player.followA11y')}
            onPress={onFollow}
            className="absolute bottom-3 min-h-11 justify-center self-center rounded-full bg-primary px-5"
          >
            <StartText className="font-bold text-primary-fg">{t('player.follow')}</StartText>
          </Pressable>
        ) : null}
      </View>
      <PlayerBar player={player} peaks={peaks} vocalsReady={vocalsReady} markers={markers} />
      <View className="bg-card px-3 pb-2 pt-1">
        <Pressable
          testID="review-lyrics-next"
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          accessibilityHint={blocked ? t('lyrics.needTimingHint') : undefined}
          onPress={onCta}
          className={`min-h-12 flex-row items-center justify-center gap-2 rounded-lg px-4 ${blocked ? 'border border-danger bg-bg' : 'bg-primary'}`}
        >
          <StartText className={blocked ? 'text-base font-semibold text-danger' : 'text-base font-bold text-primary-fg'}>{ctaLabel}</StartText>
          {blocked ? null : <Ionicons name={directionalIcon('arrow-forward')} size={18} color={colors.primaryFg} />}
        </Pressable>
      </View>
    </View>
  );
}
