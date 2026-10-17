import { createCheckoutApiUsersCreditsCheckoutPost, listCreditPackagesApiUsersCreditsPackagesGet } from '../client';
import type { CreateCheckoutRequest } from '../client';

export type CreditPackage = { id: string; credits: number; priceCents: number; name: string };

export async function listCreditPackages(): Promise<CreditPackage[]> {
  const { data } = await listCreditPackagesApiUsersCreditsPackagesGet();
  return data.packages.map((p) => ({ id: p.id, credits: p.credits, priceCents: p.price_cents, name: p.name }));
}

// Untyped until openapi/gen.json is refreshed after gen v0.278.0 ships. (`return_to` only)
/** Stripe checkout that returns to the app (gen's https bounce → nomadkaraoke:// scheme). Returns checkout_url. */
export async function createAppCheckout(packageId: string, email: string): Promise<string> {
  const body: CreateCheckoutRequest & { return_to: 'app' } = { package_id: packageId, email, return_to: 'app' };
  const { data } = await createCheckoutApiUsersCreditsCheckoutPost({ body });
  return data.checkout_url;
}
