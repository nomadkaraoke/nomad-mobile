import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useAuth } from '../../auth/store';
import { useMeOutbox } from '../../me/meOutbox';
import { setMeQueryClient } from '../../me/queryClientRef';
import { useLibrarySettle } from '../../me/librarySettle';
import { useLovedOverrides } from '../../me/lovedOverrides';
import { useLogStore } from '../../tonight/log/logStore';
import { useOutbox } from '../../tonight/log/outbox';
import { appStorage } from '../../storage';

export const signIn = (email: string) =>
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email, createdAt: 0 } }, hydrated: true });

/** A clean world signed in as `email`. */
export function resetMe(email = 'a@example.com'): QueryClient {
  appStorage.clearAll();
  useLovedOverrides.getState().clear();
  useLibrarySettle.getState().clear();
  signIn(email);
  useMeOutbox.getState().rehydrate(email);
  useOutbox.getState().rehydrate(email);
  useLogStore.getState().rehydrate(email);
  const client = new QueryClient();
  setMeQueryClient(client);
  return client;
}

export const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

export const li = (artist: string, title: string, o: Record<string, unknown> = {}) => ({
  key: `k_${title}`, song_key: `k_${title}`, artist, title, times_sung: 1, ...o,
});
