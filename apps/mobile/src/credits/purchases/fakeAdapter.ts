import { toAlpha3 } from './countryCodes';
import type { PurchaseOutcome, PurchasesAdapter, StoreProduct } from './types';

/** The packs' US store prices (spec §4), as the store would show them. */
const PRODUCTS: StoreProduct[] = [
  { id: 'nomad_credits_1', priceString: '$9.99', price: 9.99, currency: 'USD' },
  { id: 'nomad_credits_3', priceString: '$23.99', price: 23.99, currency: 'USD' },
  { id: 'nomad_credits_5', priceString: '$34.99', price: 34.99, currency: 'USD' },
  { id: 'nomad_credits_10', priceString: '$59.99', price: 59.99, currency: 'USD' },
];

type FakeOptions = { genUrl: string; storefront: string; store: 'APP_STORE' | 'PLAY_STORE' };

/**
 * Local stack / E2E only (`FAKE_IAP`): a purchase asks gen's test API to grant the pack through the same service as
 * the RevenueCat webhook, so the credit then lands the way a real one does (the screen polls `/me`).
 */
export function createFakeAdapter({ genUrl, storefront, store }: FakeOptions): PurchasesAdapter {
  let userId: string | null = null;
  const base = genUrl.replace(/\/+$/, '');

  return {
    async configure(appUserId) {
      userId = appUserId;
    },
    async logOut() {
      userId = null;
    },
    async products(ids) {
      return PRODUCTS.filter((p) => ids.includes(p.id));
    },
    async purchase(productId): Promise<PurchaseOutcome> {
      if (!userId) return { kind: 'failed', message: 'not_signed_in' };
      try {
        const res = await fetch(`${base}/api/test/fake-iap/purchase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: productId, app_user_id: userId, store }),
        });
        return res.ok ? { kind: 'purchased' } : { kind: 'failed', message: `fake_iap_${res.status}` };
      } catch (e) {
        return { kind: 'failed', message: e instanceof Error ? e.message : 'fake_iap_failed' };
      }
    },
    async storefrontCountry() {
      return toAlpha3(storefront);
    },
  };
}
