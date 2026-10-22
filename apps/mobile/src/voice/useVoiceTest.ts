import {
  classifyVoice,
  findHeldNotes,
  gateFrames,
  noiseFloor,
  summarizeRange,
  type Classification,
  type HeldNote,
  type PitchFrame,
  type RangeSummary,
  type VoicedFrame,
} from '@nomad/core';
import { useEffect, useState } from 'react';
import { createFramer, FRAME_SIZE } from './framer';
import type { PitchSource } from './pitchSource';

export type VoiceStep = 'intro' | 'permission-denied' | 'permission-blocked' | 'low' | 'high' | 'sing' | 'result' | 'no-notes';
export type VoiceResult = { range: RangeSummary; voice: Classification };
type ActiveStep = 'low' | 'high' | 'sing';

/** Wall-clock fallback for the quiet->listening switch, started when start() resolves; the audio clock normally wins. */
const QUIET_FALLBACK_MS = 2000;
const NOTE_TIMEOUT_MS = 20_000;
const SING_MS = 15_000;
const PITCH_INTERVAL_MS = 1000 / 15;

type Setters = {
  initialSource: PitchSource;
  setStep: (s: VoiceStep) => void;
  setPhase: (p: 'quiet' | 'listening') => void;
  setLivePitch: (m: number | null) => void;
  setHeld: (h: HeldNote[]) => void;
  setStepHeldCount: (n: number) => void;
  setResult: (r: VoiceResult | null) => void;
};

function createMachine({ initialSource, setStep, setPhase, setLivePitch, setHeld, setStepHeldCount, setResult }: Setters) {
  const r = {
    source: initialSource,
    gen: 0,
    unmounted: false,
    requesting: false,
    active: false,
    beginId: 0,
    rate: 16000,
    listening: false,
    step: 'intro' as VoiceStep,
    quiet: [] as PitchFrame[],
    floor: null as number | null,
    gated: [] as VoicedFrame[],
    stepHeld: [] as HeldNote[],
    committed: [] as HeldNote[],
    timers: [] as ReturnType<typeof setTimeout>[],
    lastPitchAt: 0,
    retryTo: 'low' as ActiveStep,
  };

  const setStepBoth = (s: VoiceStep) => {
    r.step = s;
    setStep(s);
  };

  /** Invalidates the running step: later buffers and timers do nothing. */
  const stopRun = () => {
    r.gen++;
    r.active = false;
    for (const t of r.timers) clearTimeout(t);
    r.timers = [];
    r.source.stop();
  };

  const onFrame = (f: PitchFrame) => {
    // Quiet second = frames whose whole window ends by 1.0 s of audio time. The sliver of frames that start
    // before 1.0 s but end after it is ignored entirely (not floor, not notes).
    if (f.t + FRAME_SIZE / r.rate <= 1.0 + 1e-9) {
      r.quiet.push(f);
      return;
    }
    if (f.t < 1.0) return;
    if (!r.listening) {
      r.listening = true;
      setPhase('listening');
    }
    r.floor ??= noiseFloor(r.quiet);
    const [v] = gateFrames([f], r.floor);
    if (v) r.gated.push(v);
    const now = Date.now();
    if (now - r.lastPitchAt >= PITCH_INTERVAL_MS) {
      r.lastPitchAt = now;
      setLivePitch(v ? v.midi : null);
    }
  };
  const framer = createFramer(onFrame);

  const fail = (retryTo: ActiveStep) => {
    stopRun();
    r.retryTo = retryTo;
    setLivePitch(null);
    setStepBoth('no-notes');
  };

  const finishSing = () => {
    if (r.step !== 'sing') return;
    stopRun();
    const all = [...r.committed, ...findHeldNotes(r.gated)];
    const range = summarizeRange(all, r.gated);
    setLivePitch(null);
    if (!range) {
      r.committed = [];
      setHeld([]);
      fail('low');
      return;
    }
    setHeld(all);
    setResult({ range, voice: classifyVoice(range) });
    setStepBoth('result');
  };

  const enterStep = async (s: ActiveStep): Promise<void> => {
    stopRun();
    const gen = r.gen;
    r.quiet = [];
    r.floor = null;
    r.gated = [];
    r.stepHeld = [];
    r.lastPitchAt = 0;
    r.listening = false;
    r.active = true;
    framer.reset();
    setStepBoth(s);
    setPhase('quiet');
    setLivePitch(null);
    setStepHeldCount(0);
    setHeld(r.committed);

    const onBuffer: Parameters<PitchSource['start']>[0] = (b) => {
      if (gen !== r.gen) return;
      r.rate = b.sampleRate;
      const before = r.gated.length;
      framer.push(b);
      if (gen !== r.gen || r.gated.length === before) return;
      const notes = findHeldNotes(r.gated);
      if (notes.length !== r.stepHeld.length) {
        setStepHeldCount(notes.length);
        setHeld([...r.committed, ...notes]);
      }
      r.stepHeld = notes;
    };
    try {
      await r.source.start(onBuffer, s);
    } catch {
      if (gen === r.gen && !r.unmounted) {
        stopRun();
        setStepBoth('permission-denied');
      }
      return;
    }
    if (gen !== r.gen) {
      // Stopped while start() was pending: don't leave the mic running, unless a newer run now owns the source.
      if (!r.active) r.source.stop();
      return;
    }
    // Timers start once capture is running, so mic start-up latency isn't charged to the singer.
    r.timers.push(
      setTimeout(() => {
        if (gen === r.gen && !r.listening) {
          r.listening = true;
          setPhase('listening');
        }
      }, QUIET_FALLBACK_MS),
    );
    if (s === 'sing') r.timers.push(setTimeout(() => gen === r.gen && finishSing(), SING_MS));
    else r.timers.push(setTimeout(() => gen === r.gen && r.stepHeld.length === 0 && fail(s), NOTE_TIMEOUT_MS));
  };

  const begin = async (): Promise<void> => {
    if (r.requesting || r.unmounted) return;
    if (r.step !== 'intro' && r.step !== 'permission-denied' && r.step !== 'permission-blocked') return;
    r.requesting = true;
    const id = ++r.beginId;
    let perm: 'granted' | 'denied' | 'blocked';
    try {
      perm = await r.source.requestPermission();
    } catch {
      perm = 'denied';
    } finally {
      r.requesting = false;
    }
    if (r.unmounted || id !== r.beginId) return;
    if (perm === 'denied') setStepBoth('permission-denied');
    else if (perm === 'blocked') setStepBoth('permission-blocked');
    else {
      r.committed = [];
      setResult(null);
      await enterStep('low');
    }
  };

  return {
    begin,
    done() {
      if ((r.step !== 'low' && r.step !== 'high') || r.stepHeld.length < 1) return;
      r.committed = [...r.committed, ...r.stepHeld];
      void enterStep(r.step === 'low' ? 'high' : 'sing');
    },
    async retry(): Promise<void> {
      if (r.step === 'permission-denied' || r.step === 'permission-blocked') return begin();
      if (r.step === 'no-notes') {
        if (r.retryTo === 'low') r.committed = [];
        setResult(null);
        return enterStep(r.retryTo);
      }
    },
    skipSing: finishSing,
    cancel() {
      r.beginId++;
      r.requesting = false;
      stopRun();
      r.committed = [];
      r.stepHeld = [];
      r.gated = [];
      setResult(null);
      setHeld([]);
      setStepHeldCount(0);
      setLivePitch(null);
      setPhase('quiet');
      setStepBoth('intro');
    },
    mount() {
      r.unmounted = false;
    },
    setSource(next: PitchSource) {
      r.source = next;
    },
    dispose() {
      r.unmounted = true;
      stopRun();
    },
  };
}

/**
 * The ~60 s phone mic test as a state machine:
 *
 *   intro --begin()--> (permission) --denied--> permission-denied --retry()--> (permission again)
 *                                   --blocked-> permission-blocked --retry()--> (permission again)
 *                                   --granted-> low --done() [>=1 held]--> high --done() [>=1 held]--> sing
 *   low/high --20 s with no held note--> no-notes --retry()--> the same step
 *   sing --15 s | skipSing()--> result (range from >=2 held notes spanning >=3 semitones) | no-notes --retry()--> low
 *
 * Each of low/high/sing starts with a 1 s `quiet` phase (the step's noise floor), then `listening`. Every step
 * resets the framer. The floor uses only frames whose 2048-sample window ends by 1.0 s of AUDIO time; frames
 * straddling 1.0 s are ignored; `listening` starts at the first frame at/after 1.0 s (wall-clock fallback 2 s
 * after start() resolves). The 20 s / 15 s timers also start when start() resolves.
 * `source.stop()` runs on every step change and on unmount; buffers from a stopped step are dropped.
 * `cancel()` stops the run and returns to 'intro' with no result: Task 18's screen MUST call it on blur and when
 * the app is backgrounded.
 */
export function useVoiceTest(source: PitchSource) {
  const [step, setStep] = useState<VoiceStep>('intro');
  const [phase, setPhase] = useState<'quiet' | 'listening'>('quiet');
  const [livePitch, setLivePitch] = useState<number | null>(null);
  const [held, setHeld] = useState<HeldNote[]>([]);
  const [stepHeldCount, setStepHeldCount] = useState(0);
  const [result, setResult] = useState<VoiceResult | null>(null);

  // Built once, outside the render analysis: the machine is imperative (timers, refs, Date.now).
  const [api] = useState(() => createMachine({ initialSource: source, setStep, setPhase, setLivePitch, setHeld, setStepHeldCount, setResult }));
  useEffect(() => {
    api.setSource(source);
  }, [api, source]);
  // StrictMode runs setup, cleanup, setup: mount() re-arms the machine that dispose() shut down.
  useEffect(() => {
    api.mount();
    return () => api.dispose();
  }, [api]);

  return {
    step,
    phase,
    livePitch,
    held,
    result,
    /** True once the current low/high step has at least one held note, i.e. done() will advance. */
    canDone: (step === 'low' || step === 'high') && stepHeldCount > 0,
    begin: api.begin,
    done: api.done,
    retry: api.retry,
    skipSing: api.skipSing,
    cancel: api.cancel,
  };
}
