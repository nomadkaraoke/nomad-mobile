import { useTranslations } from '@nomad/i18n';
import {
  commitTapSync,
  createTapSync,
  lineDirection,
  press,
  release,
  shouldStop,
  type LyricsSegment,
  type ReviewDoc,
  type TapSyncState,
} from '@nomad/review-core';
import { Button, colors, Sheet } from '@nomad/ui';
import * as Haptics from 'expo-haptics';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { I18nManager, Platform, Pressable, Switch, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

import type { ReviewPlayer } from '../audio/useReviewPlayer';
import { REPLAY_PAD_S } from '../sheets/TimingControls';
import { ReviewStoreContext } from '../store';
import { pressClockMs, tapLatencyFor } from './latency';

/** Playback starts this long before the line (floored at 0). */
export const LEAD_IN_S = 3;
/** How often the auto-stop rule is checked while syncing (~30 Hz). */
export const STOP_CHECK_MS = 33;
const RATES = [1, 0.75, 0.5] as const;
type Rate = (typeof RATES)[number];
const UP_NEXT = 4;

export type SyncPlayer = Pick<
  ReviewPlayer,
  'now' | 'seekTo' | 'play' | 'pause' | 'setRate' | 'rate' | 'playRange' | 'duration' | 'position' | 'playing'
>;

export type TapSyncSheetProps = {
  segment: number;
  /** Default of "Keep going into the next lines" (off unless several lines were just typed). */
  keepGoing?: boolean;
  player: SyncPlayer;
  onClose: () => void;
};

/** `sync`: taking taps; `done`: the last word is in; `stopped`: playback ran 1 s past the line end. */
type Phase = 'sync' | 'done' | 'stopped';

type Session = {
  /** The doc with this session's finished lines applied (keep going); the store's doc is untouched. */
  work: ReviewDoc;
  /** Lines already finished in this session (keep going), in order. */
  finished: TapSyncState[];
  /** The line being synced now. */
  state: TapSyncState;
  phase: Phase;
};

/** Every pass with taps, in order: what Done writes. */
const passesOf = (s: Session): TapSyncState[] => [...s.finished, s.state].filter((p) => p.synced.size > 0);

/**
 * Tap To Sync (spec §4.3): playback starts 3 s before the line; finger down on the pad = the
 * current word starts, finger up = it ends (a quick tap gap-fills, a hold keeps its release).
 * Nothing touches the doc until Done, which commits every synced line in ONE store apply (one
 * undo entry). Closing any other way leaves the doc as it was.
 *
 * A press and its release can land in the same JS tick, so the gesture callbacks work on a ref
 * that mirrors the rendered session synchronously.
 */
export function TapSyncSheet({ segment, keepGoing = false, player, onClose }: TapSyncSheetProps) {
  const t = useTranslations('review');
  const store = useContext(ReviewStoreContext)!;
  const latency = tapLatencyFor(Platform.OS);
  const opts = useMemo(() => ({ fallbackEnd: player.duration > 0 ? player.duration : undefined }), [player.duration]);

  // Rendered from state; the gesture and timer callbacks read and write the ref, which every
  // update keeps in step synchronously.
  const [session, setSession] = useState<Session>(() => {
    const doc = store.getState().doc;
    const state = createTapSync(doc, segment, opts);
    return { work: doc, finished: [], state, phase: state.done ? 'done' : 'sync' };
  });
  const sessionRef = useRef(session);
  const update = useCallback((next: Session) => {
    sessionRef.current = next;
    setSession(next);
  }, []);
  const [keep, setKeepState] = useState(keepGoing);
  const keepRef = useRef(keepGoing);
  const setKeep = (on: boolean) => {
    keepRef.current = on;
    setKeepState(on);
  };
  const [rate, setRateState] = useState<Rate>(1);

  const playerRef = useRef(player);
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    playerRef.current = player;
    optsRef.current = opts;
  });
  const pressedAtRef = useRef<number | null>(null);
  // The stop check is armed only once the lead-in seek has landed (a stale clock must not stop us).
  const armedRef = useRef(false);
  const genRef = useRef(0);

  /** Seek to the lead-in of the current line, then play. */
  const leadIn = useCallback(() => {
    const gen = ++genRef.current;
    armedRef.current = false;
    void Promise.resolve(playerRef.current.seekTo(Math.max(0, sessionRef.current.state.segStart - LEAD_IN_S)))
      .then(() => {
        if (gen !== genRef.current) return;
        armedRef.current = true;
        playerRef.current.play();
      })
      .catch(() => undefined);
  }, []);

  // Open: 1× and the lead-in. Close: stop, and give the main player its speed back.
  useEffect(() => {
    const p = playerRef.current;
    const before = p.rate as Rate;
    if (before !== 1) p.setRate(1);
    leadIn();
    return () => {
      genRef.current += 1;
      playerRef.current.pause();
      playerRef.current.setRate(before);
    };
  }, [leadIn]);

  // Auto-stop one second past the line end, unless a hold is in progress.
  useEffect(() => {
    if (session.phase !== 'sync') return;
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!armedRef.current || s.phase !== 'sync') return;
      if (shouldStop(s.state, playerRef.current.now())) {
        playerRef.current.pause();
        update({ ...s, phase: 'stopped' });
      }
    }, STOP_CHECK_MS);
    return () => clearInterval(id);
  }, [session.phase, update]);

  /** Restart / Redo: the current line again from scratch (earlier finished lines are kept). */
  const restart = () => {
    pressedAtRef.current = null;
    const s = sessionRef.current;
    const state = createTapSync(s.work, s.state.segmentIndex, optsRef.current);
    update({ ...s, state, phase: state.done ? 'done' : 'sync' });
    leadIn();
  };

  /** Finger down: the current word starts now. */
  const down = useCallback(() => {
    const s = sessionRef.current;
    if (s.phase !== 'sync' || s.state.done || s.state.holding) return;
    pressedAtRef.current = pressClockMs();
    update({ ...s, state: press(s.state, playerRef.current.now() - latency) });
    void Haptics.selectionAsync().catch(() => undefined);
  }, [latency, update]);

  /** Finger up (or the touch was cancelled): the word ends; after the last word, next line or stop. */
  const up = useCallback(() => {
    const at = pressedAtRef.current;
    if (at === null) return;
    pressedAtRef.current = null;
    const s = sessionRef.current;
    const state = release(s.state, playerRef.current.now() - latency, pressClockMs() - at);
    if (!state.done) return update({ ...s, state });
    const next = state.segmentIndex + 1;
    if (keepRef.current && next < s.work.segments.length) {
      // Carry on into the next line without re-seeking: playback just keeps going.
      const work = commitTapSync(s.work, state);
      const nextState = createTapSync(work, next, optsRef.current);
      if (!nextState.done) return update({ work, finished: [...s.finished, state], state: nextState, phase: 'sync' });
    }
    playerRef.current.pause();
    update({ ...s, state, phase: 'done' });
  }, [latency, update]);

  // One gesture per press: begin = finger down (onBegin, before any activation delay), finalize =
  // finger up or cancelled. Finalize fires exactly once per begin; `up` also ignores a stray one.
  /* eslint-disable react-hooks/refs -- the callbacks run on touch (runOnJS), never during render */
  const pad = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(0)
        .maxDistance(10_000)
        .shouldCancelWhenOutside(false)
        .runOnJS(true)
        .withTestId('review-sync-pad')
        .onBegin(down)
        .onFinalize(up),
    [down, up],
  );
  /* eslint-enable react-hooks/refs */

  const done = () => {
    const ps = passesOf(sessionRef.current);
    if (ps.length) store.getState().apply((d) => ps.reduce(commitTapSync, d));
    onClose();
  };

  const playback = () => {
    const s = sessionRef.current;
    const ps = passesOf(s);
    if (!ps.length) return;
    const preview = s.state.synced.size ? commitTapSync(s.work, s.state) : s.work;
    const first = preview.segments[ps[0]!.segmentIndex];
    const last = preview.segments[ps[ps.length - 1]!.segmentIndex];
    if (first?.start_time == null || last?.end_time == null) return;
    playerRef.current.playRange(Math.max(0, first.start_time - REPLAY_PAD_S), last.end_time + REPLAY_PAD_S);
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]!;
    setRateState(next);
    playerRef.current.setRate(next);
  };

  const { state: st, phase } = session;
  const seg = st.segment;
  const syncing = phase === 'sync';
  const current = syncing ? seg.words[st.wordIndex] : undefined;
  const upNext = syncing
    ? seg.words
        .slice(st.wordIndex + 1, st.wordIndex + 1 + UP_NEXT)
        .map((w) => w.text)
        .join(' ')
    : '';

  return (
    <Sheet visible fullHeight onClose={onClose} title={t('sync.title')} testID="review-sync-sheet" closeLabel={t('close')}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View className="items-center gap-1 py-2">
          <Text
            testID="review-sync-current-word"
            className="text-4xl font-bold text-text"
            numberOfLines={1}
            adjustsFontSizeToFit
            accessibilityLiveRegion="polite"
          >
            {current ? current.text : phase === 'done' ? t('sync.lineDone') : t('sync.stopped')}
          </Text>
          <Text className="min-h-6 text-base text-muted" numberOfLines={1}>
            {upNext}
          </Text>
        </View>

        <SyncedWords segment={seg} state={st} playing={!syncing && player.playing} position={player.position} />

        {syncing ? (
          <GestureDetector gesture={pad}>
            <View
              testID="review-sync-pad"
              accessible
              accessibilityRole="button"
              accessibilityLabel={t('sync.padA11y')}
              className={`my-3 flex-1 items-center justify-center rounded-3xl ${st.holding ? 'bg-primary' : 'bg-primary/20'}`}
            >
              <Text className={`text-3xl font-bold ${st.holding ? 'text-primary-fg' : 'text-primary'}`}>{t('sync.pad')}</Text>
              <Text className="mt-2 px-6 text-center text-sm text-muted">{t('sync.hint')}</Text>
            </View>
          </GestureDetector>
        ) : (
          <View className="my-3 flex-1 justify-center gap-3">
            <Button testID="review-sync-playback" label={t('sync.playback')} variant="secondary" onPress={playback} />
            <Button testID="review-sync-redo" label={t('sync.redo')} variant="secondary" onPress={restart} />
          </View>
        )}

        <View className="flex-row items-center gap-3 py-2">
          <Text className="flex-1 text-sm text-text">{t('sync.continue')}</Text>
          <Switch
            testID="review-sync-continue"
            accessibilityLabel={t('sync.continue')}
            value={keep}
            onValueChange={setKeep}
            trackColor={{ true: colors.primary }}
          />
        </View>
        <View className="flex-row items-center gap-2">
          <Pressable
            testID="review-sync-rate"
            accessibilityRole="button"
            accessibilityLabel={t('sync.rateA11y', { rate })}
            onPress={cycleRate}
            className="min-h-12 min-w-16 items-center justify-center rounded-lg border border-border bg-bg px-3"
          >
            <Text className="text-base font-semibold text-text">{t('player.rate', { rate })}</Text>
          </Pressable>
          <View className="flex-1">
            <Button testID="review-sync-restart" label={t('sync.restart')} variant="secondary" onPress={restart} />
          </View>
          <View className="flex-1">
            <Button testID="review-sync-done" label={t('sync.done')} onPress={done} />
          </View>
        </View>
      </GestureHandlerRootView>
    </Sheet>
  );
}

/** The line's words: synced ones marked; during Play it back, the word being heard is filled. */
function SyncedWords({
  segment,
  state,
  playing,
  position,
}: {
  segment: LyricsSegment;
  state: TapSyncState;
  playing: boolean;
  position: number;
}) {
  const rtl = lineDirection(segment.text) === 'rtl';
  const flexDirection = rtl !== I18nManager.isRTL ? 'row-reverse' : 'row';
  return (
    <View style={{ flexDirection, flexWrap: 'wrap', gap: 6, justifyContent: 'center' }} className="py-2">
      {segment.words.map((w, i) => {
        const synced = state.synced.has(i);
        const hearing =
          playing && synced && w.start_time !== null && w.end_time !== null && position >= w.start_time && position < w.end_time;
        const current = !state.done && i === state.wordIndex;
        const look = hearing
          ? 'bg-primary text-primary-fg'
          : current
            ? 'border border-primary text-text'
            : synced
              ? 'text-primary'
              : 'text-muted';
        return (
          <Text
            key={w.id}
            testID={`review-sync-word-${i}`}
            accessibilityState={{ selected: synced }}
            className={`rounded-md px-1.5 py-0.5 text-lg ${look}`}
          >
            {w.text}
          </Text>
        );
      })}
    </View>
  );
}
