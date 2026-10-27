import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { InteractionManager } from 'react-native';

import { askPushPermissionInContext, requestPushAsk, takePendingPushAsk, type PushContext } from './push';

/** After the landing transition (and any closing sheet) has settled: iOS drops an Alert raised during either. */
export const PUSH_ASK_SETTLE_MS = 700;

/**
 * The screen a flow lands on runs the in-context ask the flow queued (requestPushAsk): the Make tab after a make
 * starts, Tonight after joining a night. Waits for interactions plus PUSH_ASK_SETTLE_MS; leaving first keeps it queued.
 */
export function usePendingPushAsk(where: PushContext): void {
  useFocusEffect(
    useCallback(() => {
      if (!takePendingPushAsk(where)) return;
      let fired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const task = InteractionManager.runAfterInteractions(() => {
        timer = setTimeout(() => {
          fired = true;
          void askPushPermissionInContext(where);
        }, PUSH_ASK_SETTLE_MS);
      });
      return () => {
        task.cancel();
        if (timer) clearTimeout(timer);
        if (!fired) requestPushAsk(where);
      };
    }, [where]),
  );
}
