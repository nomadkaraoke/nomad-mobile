import { Sheet, type SheetProps } from '@nomad/ui';
import { useEffect } from 'react';

import { useEditingStore } from './nomad/editingStore';

/**
 * Registers an open sheet or modal with the Tonight screens (ruling E8-R3: the automatic post-song survey waits while
 * one is up instead of stacking on top). Counts while `visible` is true and releases on hide and on unmount.
 * Every Tonight sheet goes through `TonightSheet` (which calls this); a custom modal calls it directly.
 */
export function useSheetPresence(visible: boolean): void {
  useEffect(() => {
    if (!visible) return;
    useEditingStore.getState().openSheet();
    return () => useEditingStore.getState().closeSheet();
  }, [visible]);
}

export type TonightSheetProps = SheetProps & {
  /** Only the survey sheet itself passes false (it must not hold itself back). */
  holdsSurvey?: boolean;
};

/** `@nomad/ui` Sheet for the Tonight module: the only way Tonight code opens a sheet (a test enforces it). */
export function TonightSheet({ holdsSurvey = true, ...props }: TonightSheetProps) {
  useSheetPresence(holdsSurvey && props.visible);
  return <Sheet {...props} />;
}
