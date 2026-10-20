import { isolate, isolateLtr } from '../bidi';

it('wraps a value in first-strong isolate marks so it keeps its own direction inside a translated sentence', () => {
  expect(isolate('The First Noel')).toBe('⁨The First Noel⁩');
  expect(isolate('')).toBe('');
});

it('wraps numbers-only text (times, rates) in left-to-right isolate marks so RTL text does not reorder it', () => {
  // Without it Android's RTL layout showed the player time "0:06 / 0:30" as "0:30 / 0:06".
  expect(isolateLtr('0:06 / 0:30')).toBe('⁦0:06 / 0:30⁩');
  expect(isolateLtr('')).toBe('');
});
