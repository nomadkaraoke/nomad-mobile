/** A store product as the credits screen shows it: the store's own localized price. */
export type StoreProduct = { id: string; priceString: string; price: number; currency: string };

/** `pending`: the store took the order but the payment waits (Ask to Buy, deferred payment); gen credits it later. */
export type PurchaseOutcome =
  | { kind: 'purchased' }
  | { kind: 'cancelled' }
  | { kind: 'pending' }
  | { kind: 'failed'; message: string };

/**
 * Every in-app purchase goes through this, so the local stack's fake (gen's test API) is a drop-in for RevenueCat.
 * Identity is gen's opaque `app_user_id` only (never an email: no PII to the store SDK).
 */
export interface PurchasesAdapter {
  /** Identifies the store customer as this gen user (RevenueCat `logIn`); a repeat call for the same id is a no-op. */
  configure(appUserId: string): Promise<void>;
  /** Forgets the store customer (sign-out); a no-op when nobody is identified. */
  logOut(): Promise<void>;
  /** The store's products for these ids; ids the store doesn't know are left out. */
  products(ids: string[]): Promise<StoreProduct[]>;
  purchase(productId: string): Promise<PurchaseOutcome>;
  /** The store account's country as ISO 3166-1 alpha-3 (`USA`; Play's alpha-2 is mapped), or null if unknown. */
  storefrontCountry(): Promise<string | null>;
}
