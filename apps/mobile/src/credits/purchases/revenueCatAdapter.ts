import Purchases, { PRODUCT_CATEGORY, PURCHASES_ERROR_CODE, type PurchasesStoreProduct } from 'react-native-purchases';

import { toAlpha3 } from './countryCodes';
import type { PurchaseOutcome, PurchasesAdapter, StoreProduct } from './types';

const toProduct = (p: PurchasesStoreProduct): StoreProduct => ({
  id: p.identifier,
  priceString: p.priceString,
  price: p.price,
  currency: p.currencyCode,
});

const errorMessage = (e: unknown) =>
  e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' ? e.message : 'purchase_failed';

const errorCode = (e: unknown) => (e && typeof e === 'object' && 'code' in e ? e.code : undefined);

const isCancel = (e: unknown) =>
  errorCode(e) === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR ||
  (!!e && typeof e === 'object' && 'userCancelled' in e && e.userCancelled === true);

/**
 * RevenueCat with the platform's public SDK key. The SDK is configured once per launch: as the gen user when
 * `configure` comes first (no anonymous customer), else anonymously for a product or storefront lookup, and
 * `logIn` then moves it to the gen user. Credit packs are consumables (`NON_SUBSCRIPTION`).
 *
 * Identity changes (configure / logIn / logOut) run one at a time on a single chain, so a sign-out's logOut can't
 * land after the next person's logIn. A purchase also asks the SDK who it is right before the store sheet: buying
 * as the wrong (or an anonymous) customer would take the money without gen crediting anyone.
 */
export function createRevenueCatAdapter(apiKey: string): PurchasesAdapter {
  let configured = false;
  let userId: string | null = null;
  const cache = new Map<string, PurchasesStoreProduct>();

  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const run = chain.then(op, op);
    chain = run.catch(() => {});
    return run;
  };

  const ensureConfigured = () => {
    if (configured) return;
    Purchases.configure({ apiKey });
    configured = true;
  };

  const identify = (appUserId: string) =>
    serial(async () => {
      if (!configured) {
        Purchases.configure({ apiKey, appUserID: appUserId });
        configured = true;
      } else if (userId !== appUserId) {
        await Purchases.logIn(appUserId);
      }
      userId = appUserId;
    });

  /**
   * True when the SDK is the expected gen user (logging in again once if it is not). False without a logIn when the
   * person signed out or another account signed in since the tap: buying for the old account is never right.
   */
  const verifyIdentity = (expected: string) =>
    serial(async () => {
      if (userId !== expected) return false;
      if ((await Purchases.getAppUserID()) === expected) return true;
      await Purchases.logIn(expected);
      userId = expected;
      return (await Purchases.getAppUserID()) === expected;
    });

  const fetchProducts = async (ids: string[]) => {
    ensureConfigured();
    const found = await Purchases.getProducts(ids, PRODUCT_CATEGORY.NON_SUBSCRIPTION);
    for (const p of found) cache.set(p.identifier, p);
    return found;
  };

  return {
    configure: identify,

    logOut: () =>
      serial(async () => {
        if (!configured || !userId) return; // RevenueCat rejects logOut for an anonymous customer
        await Purchases.logOut();
        userId = null;
      }),

    async products(ids) {
      return (await fetchProducts(ids)).map(toProduct);
    },

    async purchase(productId): Promise<PurchaseOutcome> {
      try {
        await chain; // let a pending identity change finish first
        const expected = userId;
        if (!expected) return { kind: 'failed', message: 'not_identified' };
        const product = cache.get(productId) ?? (await fetchProducts([productId])).find((p) => p.identifier === productId);
        if (!product) return { kind: 'failed', message: 'unknown_product' };
        if (!(await verifyIdentity(expected))) return { kind: 'failed', message: 'identity_mismatch' };
        await Purchases.purchaseStoreProduct(product);
        return { kind: 'purchased' };
      } catch (e) {
        if (isCancel(e)) return { kind: 'cancelled' };
        if (errorCode(e) === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return { kind: 'pending' };
        return { kind: 'failed', message: errorMessage(e) };
      }
    },

    async storefrontCountry() {
      ensureConfigured();
      const code = (await Purchases.getStorefront())?.countryCode;
      return code ? toAlpha3(code) : null;
    },
  };
}
