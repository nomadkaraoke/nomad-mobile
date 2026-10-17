import { createHandoffUrl, isApiError } from '@nomad/api-gen';
import type { QueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';

import { GEN_WEB_URL } from '../config';
import { currentLocale } from '../locale';

/**
 * The review bridge (spec §4.8, minimal; Phase 2 replaces it): a single-use signed-in link to the
 * job's web review, opened in the in-app browser. Gen only mints one for a job in review (409
 * otherwise), so other needs-you jobs open the web app instead. When the browser closes the list
 * refetches. (Android resolves as soon as the tab opens; the foreground refetch covers its return.)
 */
export async function openReview(jobId: string, queryClient: QueryClient): Promise<void> {
  let url: string;
  try {
    url = await createHandoffUrl(jobId, currentLocale());
  } catch (e) {
    if (!isApiError(e, 409)) throw e;
    url = `${GEN_WEB_URL}/app`;
  }
  try {
    await WebBrowser.openBrowserAsync(url);
  } finally {
    void queryClient.invalidateQueries({ queryKey: ['jobs'] });
  }
}
