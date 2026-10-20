import { fromCorrectionData } from '@nomad/review-core';
import { QueryClient } from '@tanstack/react-query';

import { openWebHandoff } from '../../jobs/openWebHandoff';
import { continueOnWeb } from '../../review/continueOnWeb';
import { cleanFixture } from '../../test-utils/reviewFixtures';

jest.mock('@nomad/api-gen', () => ({ saveReviewSession: jest.fn() }));
jest.mock('../../jobs/openWebHandoff', () => ({ openWebHandoff: jest.fn(async () => {}) }));
const { saveReviewSession } = jest.requireMock('@nomad/api-gen') as { saveReviewSession: jest.Mock };
const handoff = openWebHandoff as jest.Mock;

const queryClient = new QueryClient();
const doc = () => {
  const d = fromCorrectionData(cleanFixture({ replay_like_unknown_key: 7 } as never));
  return { ...d, segments: d.segments.slice(1) };
};

beforeEach(() => {
  jest.clearAllMocks();
  saveReviewSession.mockResolvedValue(undefined);
});

describe('continueOnWeb', () => {
  it('saves the edits as a review session before opening the web handoff', async () => {
    await continueOnWeb('j1', doc(), 3, queryClient);
    expect(saveReviewSession).toHaveBeenCalledTimes(1);
    const [jobId, data, editCount] = saveReviewSession.mock.calls[0]!;
    expect(jobId).toBe('j1');
    expect(editCount).toBe(3);
    expect(data.corrected_segments).toHaveLength(1); // the edited lyrics, not gen's original
    expect(data.replay_like_unknown_key).toBe(7); // unknown keys round-trip
    expect(handoff).toHaveBeenCalledWith('j1', queryClient);
    expect(saveReviewSession.mock.invocationCallOrder[0]).toBeLessThan(handoff.mock.invocationCallOrder[0]!);
  });

  it('carries is_duet only when known (Ruling M)', async () => {
    await continueOnWeb('j1', doc(), 1, queryClient);
    expect(saveReviewSession.mock.calls[0]![1]).not.toHaveProperty('is_duet');
    await continueOnWeb('j1', doc(), 1, queryClient, true);
    expect(saveReviewSession.mock.calls[1]![1].is_duet).toBe(true);
  });

  it('with no edits there is nothing to hand over: no session save', async () => {
    await continueOnWeb('j1', doc(), 0, queryClient);
    expect(saveReviewSession).not.toHaveBeenCalled();
    expect(handoff).toHaveBeenCalledWith('j1', queryClient);
  });

  it('a failed session save still opens the web (the escape hatch must not be blocked)', async () => {
    saveReviewSession.mockRejectedValue(new Error('offline'));
    await continueOnWeb('j1', doc(), 2, queryClient);
    expect(handoff).toHaveBeenCalled();
  });

  it('a failed handoff rejects so the screen can say so', async () => {
    handoff.mockRejectedValueOnce(new Error('500'));
    await expect(continueOnWeb('j1', doc(), 0, queryClient)).rejects.toThrow('500');
  });
});
