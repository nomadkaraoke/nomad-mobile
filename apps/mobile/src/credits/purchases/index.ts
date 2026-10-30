import { Platform } from 'react-native';

import { FAKE_IAP, FAKE_STOREFRONT, GEN_API_URL, REVENUECAT_ANDROID_KEY, REVENUECAT_IOS_KEY } from '../../config';
import { createFakeAdapter } from './fakeAdapter';
import { createRevenueCatAdapter } from './revenueCatAdapter';
import type { PurchasesAdapter } from './types';

export type { PurchaseOutcome, PurchasesAdapter, StoreProduct } from './types';

let adapter: PurchasesAdapter | null | undefined;

function create(): PurchasesAdapter | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  if (FAKE_IAP) {
    return createFakeAdapter({
      genUrl: GEN_API_URL,
      storefront: FAKE_STOREFRONT,
      store: Platform.OS === 'ios' ? 'APP_STORE' : 'PLAY_STORE',
    });
  }
  const key = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
  return key ? createRevenueCatAdapter(key) : null;
}

/** The app's purchases adapter, or null when in-app purchases are off (no RevenueCat key: web checkout). */
export function getPurchases(): PurchasesAdapter | null {
  if (adapter === undefined) adapter = create();
  return adapter;
}
