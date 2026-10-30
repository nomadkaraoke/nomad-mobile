import { z } from 'zod';

/**
 * Gen's credit packages response (`GET /api/users/credits/packages`). `store_product_id` and `web_link` are newer
 * than the committed OpenAPI snapshot (gen Phase 6), so both are read leniently: an older gen, or a malformed
 * value, reads as absent instead of failing the screen.
 */
export const WebLinkSchema = z.object({
  show_for: z.object({ ios: z.array(z.string()), android: z.array(z.string()) }),
  copy_key: z.string().min(1),
});

export const CreditPackagesSchema = z.object({
  packages: z.array(
    z.object({
      id: z.string(),
      credits: z.number(),
      price_cents: z.number(),
      name: z.string(),
      store_product_id: z.string().min(1).nullish().catch(undefined),
    }),
  ),
  web_link: WebLinkSchema.nullish().catch(undefined),
});
