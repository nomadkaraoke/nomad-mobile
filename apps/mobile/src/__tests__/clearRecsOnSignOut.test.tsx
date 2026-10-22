// clearRecsOnSignOut: signing out wipes the offline Discover picks even with Discover unmounted (Task E10 carry).
import { renderHook } from '@testing-library/react-native';

import { useAuth } from '../auth/store';
import { loadRecsSnapshot, saveRecsSnapshot } from '../discover/recsSnapshot';
import { useClearRecsOnSignOut } from '../discover/useClearRecsOnSignOut';
import { appStorage } from '../storage';

const data = { sections: [], has_profile: true } as never;
const signedIn = { status: 'signedIn', session: { token: 't', email: 'me@example.com', createdAt: 0 } } as const;

beforeEach(() => {
  appStorage.clearAll();
  useAuth.setState({ state: signedIn, hydrated: true });
});

it('clears the snapshot when the session ends', () => {
  renderHook(() => useClearRecsOnSignOut());
  saveRecsSnapshot('me@example.com\nk', data);
  expect(loadRecsSnapshot()).not.toBeNull();
  useAuth.setState({ state: { status: 'signedOut' } });
  expect(loadRecsSnapshot()).toBeNull();
});

it('keeps the snapshot while signed in', () => {
  renderHook(() => useClearRecsOnSignOut());
  saveRecsSnapshot('me@example.com\nk', data);
  useAuth.setState({ state: signedIn });
  expect(loadRecsSnapshot()).not.toBeNull();
});
