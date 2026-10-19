import { logSearchEvent } from '@nomad/api-decide';

import { currentSid, logEvent, renewSid } from '../searchSession';

jest.mock('@nomad/api-decide', () => ({ logSearchEvent: jest.fn(async () => {}) }));

it('keeps one 32-hex search-session id until renewed after a pick', () => {
  const sid = currentSid();
  expect(sid).toMatch(/^[0-9a-f]{32}$/);
  expect(currentSid()).toBe(sid);
  const next = renewSid();
  expect(next).toMatch(/^[0-9a-f]{32}$/);
  expect(next).not.toBe(sid);
  expect(currentSid()).toBe(next);
});

it('logs events under the current session, fire and forget', () => {
  logEvent('keep_typed', { q: 'hello' });
  expect(logSearchEvent).toHaveBeenCalledWith({ sid: currentSid(), type: 'keep_typed', data: { q: 'hello' } });
  expect(logEvent('not_it')).toBeUndefined();
});
