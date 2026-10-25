// Me's "Your sessions" (Phase 3d tuning batch 1): decide's `GET /api/voice/history` (newest first, at most 20
// sessions with their songs, results and recordings). Read again after an upload lands, after an exclude or delete,
// and whenever Me comes back into focus (it stays mounted under the session modal).
import { getVoiceHistory, type VoiceHistoryOut } from '@nomad/api-decide';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { useAuth } from '../auth/store';
import { onRecordingsUploaded } from './recording/recordingQueue';

export const VOICE_HISTORY_KEY = ['voiceSession', 'history'] as const;

export function useVoiceHistory() {
  const queryClient = useQueryClient();
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  const query = useQuery<VoiceHistoryOut>({
    queryKey: [...VOICE_HISTORY_KEY, email],
    enabled: !!email,
    queryFn: getVoiceHistory,
    retry: false,
  });
  const refetch = query.refetch;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false; // the query's own mount fetch covers this one
        return;
      }
      if (email) void refetch();
    }, [email, refetch]),
  );
  useEffect(
    () => onRecordingsUploaded(() => void queryClient.invalidateQueries({ queryKey: VOICE_HISTORY_KEY })),
    [queryClient],
  );
  return query;
}
