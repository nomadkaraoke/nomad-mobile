import { useEffect } from 'react';

import { useAuth } from '../auth/store';
import { clearRecsSnapshot } from './recsSnapshot';

/**
 * Forgets the offline Discover picks the moment the person signs out, whichever screen they are on (the
 * Discover tab may not be mounted). Mounted once in AppProviders; the API clients stay out of storage.
 */
export function useClearRecsOnSignOut(): void {
  useEffect(
    () =>
      useAuth.subscribe((state, prev) => {
        if (prev.state.status === 'signedIn' && state.state.status !== 'signedIn') clearRecsSnapshot();
      }),
    [],
  );
}
