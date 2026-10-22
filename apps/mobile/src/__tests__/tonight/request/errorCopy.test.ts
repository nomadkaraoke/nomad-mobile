import { KjboxError } from '@nomad/api-kjbox';

import en from '../../../../../../packages/i18n/messages/en.json';
import contract from '../../../../../../openapi/kjbox.json';
import { ERROR_CODES_WITH_COPY, errorCopy, errorCopyKey } from '../../../tonight/request/errorCopy';

const lookup = (key: string): unknown =>
  key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), en);

const contractCodes = (contract as { components: { schemas: { ErrorCode: { enum: string[] } } } }).components.schemas.ErrorCode
  .enum;

describe('every error code has copy (ruling E5-R5, A.27)', () => {
  it('maps exactly the contract enum, including internal', () => {
    expect([...ERROR_CODES_WITH_COPY].sort()).toEqual([...contractCodes].sort());
    expect(contractCodes).toContain('internal');
  });

  it.each(contractCodes)('%s has an English string under tonight.errors', (code) => {
    const key = errorCopyKey(code as never);
    expect(key.startsWith('tonight.errors.')).toBe(true);
    expect(typeof lookup(key)).toBe('string');
  });
});

describe('errorCopy', () => {
  it('rate_limited shows the wait from retry_after, in minutes', () => {
    expect(errorCopy(new KjboxError('rate_limited', 429, 150))).toEqual({
      key: 'tonight.errors.rateLimitedWait',
      values: { minutes: 3 },
    });
    expect(typeof lookup('tonight.errors.rateLimitedWait')).toBe('string');
  });

  it('rate_limited without retry_after uses the plain copy', () => {
    expect(errorCopy(new KjboxError('rate_limited', 429))).toEqual({ key: 'tonight.errors.rateLimited' });
  });

  it('an unreachable box (or a non-kjbox throw) says so', () => {
    expect(errorCopy(new KjboxError('internal', 0, undefined, {}, true)).key).toBe('tonight.errors.unreachable');
    expect(errorCopy(new Error('boom')).key).toBe('tonight.errors.unreachable');
    expect(typeof lookup('tonight.errors.unreachable')).toBe('string');
  });

  it('a coded error uses its own copy', () => {
    expect(errorCopy(new KjboxError('youtube_blocked', 400)).key).toBe('tonight.errors.youtubeBlocked');
  });
});
