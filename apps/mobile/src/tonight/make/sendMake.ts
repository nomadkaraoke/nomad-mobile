import { KjboxError } from '@nomad/api-kjbox';

/**
 * Make-submit retry timings (mutable so tests can shrink them). The box holds a make submit's idempotency claim for
 * 420 s (gen's create-job budget + 60 s) and answers retries with 409 busy_retry meanwhile; a call can also time out
 * on our side (MAKE_TIMEOUT_MS) or at Cloudflare (100 s) while the box carries on. So the app keeps asking with the
 * SAME client_request_id until the box replays the first answer, a bit past the claim's lifetime.
 */
export const makeTiming = {
  /** Shortest wait between attempts (the box's retry_after, usually 2 s, wins when longer). */
  retryMinMs: 3_000,
  /** Give up asking after this long (the claim's 420 s plus a margin). */
  budgetMs: 480_000,
};

/** The send's outcome is still unknown after the whole budget: the song may yet appear in Your songs. */
export class MakeStillPending extends Error {
  readonly name = 'MakeStillPending';
}

/** Worth asking again with the same id: the box is still on it (busy_retry) or we lost the answer (unreachable). */
const retryable = (e: unknown) => e instanceof KjboxError && (e.code === 'busy_retry' || e.unreachable);

/**
 * Sends once, then keeps retrying `send` (which must reuse one client_request_id) while the outcome is unknown.
 * `onWaiting` fires before the first retry ("Still working…"); `alive()` false stops it (the screen left).
 */
export async function sendMake<T>(send: () => Promise<T>, opts: { onWaiting?: () => void; alive?: () => boolean } = {}): Promise<T> {
  const deadline = Date.now() + makeTiming.budgetMs;
  let waited = false;
  for (;;) {
    try {
      return await send();
    } catch (e) {
      if (!retryable(e)) throw e;
      if (opts.alive && !opts.alive()) throw e;
      const retryAfter = e instanceof KjboxError && e.retryAfter ? e.retryAfter * 1000 : 0;
      const delay = Math.max(makeTiming.retryMinMs, retryAfter);
      if (Date.now() + delay > deadline) throw new MakeStillPending();
      if (!waited) {
        waited = true;
        opts.onWaiting?.();
      }
      await new Promise((r) => setTimeout(r, delay));
      if (opts.alive && !opts.alive()) throw e;
    }
  }
}
