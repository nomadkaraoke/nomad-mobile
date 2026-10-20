import { saveReviewSession } from '@nomad/api-gen';
import { toSubmission, type ReviewDoc } from '@nomad/review-core';
import type { QueryClient } from '@tanstack/react-query';

import { openWebHandoff } from '../jobs/openWebHandoff';

/**
 * "Continue on web" (spec §4.7): saves the phone's edits as a gen review session (trigger `manual`)
 * so the web's restore dialog offers them, then opens the signed-in web handoff. With no edits there
 * is nothing to hand over, so no session is saved. A failed save still opens the web (it is the
 * escape hatch when things go wrong); the edits stay in the phone's draft either way. `isDuet` is the
 * flag when known (Ruling M, `duetToSend`), else the doc keeps gen's own.
 */
export async function continueOnWeb(
  jobId: string,
  doc: ReviewDoc,
  editCount: number,
  queryClient: QueryClient,
  isDuet?: boolean,
): Promise<void> {
  if (editCount > 0) {
    try {
      await saveReviewSession(jobId, toSubmission(doc, isDuet), editCount);
    } catch {
      // see above: never block the way out
    }
  }
  await openWebHandoff(jobId, queryClient);
}
