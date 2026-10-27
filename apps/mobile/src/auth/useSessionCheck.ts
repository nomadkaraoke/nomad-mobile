import { getMe } from '@nomad/api-gen';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { getPurchases } from '../credits/purchases';
import { setObservabilityUser } from '../observability';
import { useAuth } from './store';

/**
 * Spec §5: re-reads `GET /api/users/me` on launch and whenever the app comes to the foreground while signed in.
 * A dead session answers 401 and the gen client's onUnauthorized signs out (api/setup.ts); a success refreshes
 * the cached balance and tells Sentry and the store SDK who (gen's opaque app_user_id, never the email). Errors are swallowed: an offline launch must not sign anyone out.
 */
export function useSessionCheck() {
  const queryClient = useQueryClient();
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));

  useEffect(() => {
    if (!email) {
      setObservabilityUser(null);
      return;
    }
    const check = () =>
      void queryClient
        .prefetchQuery({
          queryKey: ['me', email],
          staleTime: 0,
          queryFn: async () => {
            const me = await getMe();
            if (me.appUserId && useAuth.getState().state.status === 'signedIn') {
              setObservabilityUser(me.appUserId);
              // RevenueCat logIn: store purchases are credited to this gen user (best-effort; the buy path retries).
              getPurchases()?.configure(me.appUserId).catch(() => {});
            }
            return me;
          },
        });
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [email, queryClient]);
}
