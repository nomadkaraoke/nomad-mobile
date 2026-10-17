import { getMe } from '@nomad/api-gen';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuth } from './store';

/**
 * Spec §5: re-reads `GET /api/users/me` on launch and whenever the app comes to the foreground while signed in.
 * A dead session answers 401 and the gen client's onUnauthorized signs out (api/setup.ts); a success refreshes
 * the cached balance. Errors are swallowed: an offline launch must not sign anyone out.
 */
export function useSessionCheck() {
  const queryClient = useQueryClient();
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));

  useEffect(() => {
    if (!email) return;
    const check = () => void queryClient.prefetchQuery({ queryKey: ['me', email], queryFn: getMe, staleTime: 0 });
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [email, queryClient]);
}
