import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

let bound: QueryClient | null = null;

/**
 * The app's QueryClient for code outside React (the outboxes' onSent hooks write a sent result into the query cache).
 * Bound by the Me hooks and by `useClearMeOnAccountChange` (mounted once in AppProviders); the latest bind wins.
 */
export const meQueryClient = (): QueryClient | null => bound;

/** Binds the client (tests bind each fresh one; the app binds through the hook). */
export const setMeQueryClient = (client: QueryClient | null): void => {
  bound = client;
};

export function useBindMeQueryClient(client: QueryClient): void {
  useEffect(() => setMeQueryClient(client), [client]);
}
