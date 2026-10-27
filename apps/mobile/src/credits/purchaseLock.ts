/** One payment at a time: a double tap, or Buy and the web link together when a screen shares one lock. */
export type PurchaseLock = { tryAcquire(): boolean; release(): void };

export function createPurchaseLock(): PurchaseLock {
  let held = false;
  return {
    tryAcquire() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
  };
}
