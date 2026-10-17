import { z } from 'zod';

import { ApiError } from '../configure';

/** Optional field that maps JSON `null` to `undefined`, so parsed types fit @nomad/core's optional props. */
export const opt = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? undefined);

/** Validate a response body; a shape mismatch throws `ApiError(0, 'invalid_response')` like every other facade failure. */
export function parseResponse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new ApiError(0, 'invalid_response');
  return result.data;
}
