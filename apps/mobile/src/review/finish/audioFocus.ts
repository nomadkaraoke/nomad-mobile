import { createContext, useContext, useEffect, useRef } from 'react';

/** Who is making sound on the Finish step: the A/B instrumental players or the preview video. */
export type AudioOwner = 'ab' | 'preview';

export type AudioFocus = {
  /** `owner` started playing: pause every other owner. */
  claim(owner: AudioOwner): void;
  /** Registers how to pause `owner`; returns the unregister. */
  register(owner: AudioOwner, pause: () => void): () => void;
};

/** One audible thing at a time on Finish (the A/B stems and the preview would otherwise play over each other). */
export function createAudioFocus(): AudioFocus {
  const pausers = new Map<AudioOwner, () => void>();
  return {
    claim(owner) {
      pausers.forEach((pause, o) => {
        if (o !== owner) pause();
      });
    },
    register(owner, pause) {
      pausers.set(owner, pause);
      return () => {
        if (pausers.get(owner) === pause) pausers.delete(owner);
      };
    },
  };
}

export const AudioFocusContext = createContext<AudioFocus | null>(null);

/**
 * Joins the Finish step's audio focus as `owner`: `pause` is called when the other owner starts, and
 * `playing` turning true pauses the other owner. A no-op outside a provider.
 */
export function useAudioFocus(owner: AudioOwner, playing: boolean, pause: (() => void) | null): void {
  const focus = useContext(AudioFocusContext);
  const pauseRef = useRef(pause);
  useEffect(() => {
    pauseRef.current = pause;
  });
  useEffect(() => focus?.register(owner, () => pauseRef.current?.()), [focus, owner]);
  useEffect(() => {
    if (playing) focus?.claim(owner);
  }, [focus, owner, playing]);
}
