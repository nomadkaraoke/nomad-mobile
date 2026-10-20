import { LruCache } from '../lru';

it('evicts the least recently used entry past capacity', () => {
  const c = new LruCache<string, number>(2);
  c.set('a', 1);
  c.set('b', 2);
  expect(c.get('a')).toBe(1); // a is now the most recent
  c.set('c', 3);
  expect(c.get('b')).toBeUndefined();
  expect(c.get('a')).toBe(1);
  expect(c.get('c')).toBe(3);
  expect(c.size).toBe(2);
});

it('overwriting a key refreshes it and does not grow the cache', () => {
  const c = new LruCache<string, number>(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('a', 10);
  c.set('c', 3);
  expect(c.get('a')).toBe(10);
  expect(c.get('b')).toBeUndefined();
  expect(c.size).toBe(2);
});
