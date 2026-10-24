import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth } from '../auth/store';
import { appStorage } from '../storage';
import { useVoiceStore } from '../voice/voiceStore';
import { SERVICES_SUMMARY_KEY } from './connect/queries';
import { PROFILE_KEY } from './profile/useMusicProfile';
import { QUIZ_STORAGE_KEY, useQuizDraft } from './quizStore';
import { clearRecsSnapshot } from './recsSnapshot';
import { useDiscoverStale } from './staleStore';
import { RECS_KEY } from './useRecommendations';

/**
 * Forgets everything personal Discover holds the moment the person signs out, whichever screen they are on (the
 * Discover tab may not be mounted): the cached picks, music profile and connected-sources summary, the quiz draft (memory and this phone's
 * copy), the stale flag, the offline picks and the voice profile. The next person to sign in never sees any of it. Mounted once in
 * AppProviders; the API clients stay out of storage.
 */
export function useClearDiscoverOnSignOut(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      useAuth.subscribe((state, prev) => {
        if (prev.state.status !== 'signedIn' || state.state.status === 'signedIn') return;
        queryClient.removeQueries({ queryKey: RECS_KEY });
        queryClient.removeQueries({ queryKey: PROFILE_KEY });
        queryClient.removeQueries({ queryKey: SERVICES_SUMMARY_KEY });
        const quiz = useQuizDraft.getState();
        quiz.clear();
        quiz.reset();
        appStorage.remove(QUIZ_STORAGE_KEY);
        useDiscoverStale.getState().clear();
        clearRecsSnapshot();
        useVoiceStore.getState().clear();
      }),
    [queryClient],
  );
}
