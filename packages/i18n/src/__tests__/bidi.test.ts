import { isolate } from '../bidi';

it('wraps a value in first-strong isolate marks so it keeps its own direction inside a translated sentence', () => {
  expect(isolate('The First Noel')).toBe('⁨The First Noel⁩');
  expect(isolate('')).toBe('');
});
