import { createCheckoutApiUsersCreditsCheckoutPost, listCreditPackagesApiUsersCreditsPackagesGet } from '../client';
import type { CreateCheckoutRequest } from '../client';
import { CreditPackagesSchema } from '../overrides/credits';
import { parseResponse } from '../overrides/parse';

/** `storeProductId`: the App Store / Play product id that sells this package in the app (absent on older gen). */
export type CreditPackage = { id: string; credits: number; priceCents: number; name: string; storeProductId?: string };

/** Store countries (storefront codes, e.g. `USA`) where the app may offer web checkout, and its button copy key. */
export type WebLink = { showFor: { ios: string[]; android: string[] }; copyKey: string };

/** The packages plus the web-link rollout; `webLink` is absent on a gen that predates it (no web link then). */
export type CreditCatalog = { packages: CreditPackage[]; webLink?: WebLink };

export async function getCreditCatalog(): Promise<CreditCatalog> {
  const { data } = await listCreditPackagesApiUsersCreditsPackagesGet();
  const body = parseResponse(CreditPackagesSchema, data);
  const packages = body.packages.map((p) => ({
    id: p.id,
    credits: p.credits,
    priceCents: p.price_cents,
    name: p.name,
    ...(p.store_product_id ? { storeProductId: p.store_product_id } : {}),
  }));
  const w = body.web_link;
  return { packages, ...(w ? { webLink: { showFor: w.show_for, copyKey: w.copy_key } } : {}) };
}

export async function listCreditPackages(): Promise<CreditPackage[]> {
  return (await getCreditCatalog()).packages;
}

/** Stripe checkout that returns to the app (gen's https bounce → nomadkaraoke:// scheme). Returns checkout_url. */
export async function createAppCheckout(packageId: string, email: string): Promise<string> {
  const body: CreateCheckoutRequest = { package_id: packageId, email, return_to: 'app' };
  const { data } = await createCheckoutApiUsersCreditsCheckoutPost({ body });
  return data.checkout_url;
}
