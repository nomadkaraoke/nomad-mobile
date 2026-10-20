import { mediaUrl } from '../media';

const API = 'https://api.example.com';
describe('mediaUrl', () => {
  it('hangs /api/ paths off the base', () => {
    expect(mediaUrl(API, 'j1', '/api/review/j1/audio', 'tk')).toBe(`${API}/api/review/j1/audio?token=tk`);
  });
  it('prefixes instrumental-audio style paths with /api/review/{jobId}', () => {
    expect(mediaUrl(API, 'j1', '/instrumental-audio/clean', 'tk')).toBe(`${API}/api/review/j1/instrumental-audio/clean?token=tk`);
    expect(mediaUrl(`${API}/`, 'j 1', 'instrumental-audio/x', null)).toBe(`${API}/api/review/j%201/instrumental-audio/x`);
  });
  it('appends with & when a query string exists, and encodes the token', () => {
    expect(mediaUrl(API, 'j1', '/api/x?v=2', 'a b&c')).toBe(`${API}/api/x?v=2&token=a%20b%26c`);
  });
  it('adds the token to absolute URLs on the API origin only', () => {
    expect(mediaUrl(API, 'j1', `${API}/api/review/j1/x`, 't')).toBe(`${API}/api/review/j1/x?token=t`);
    expect(mediaUrl(API, 'j1', 'HTTPS://API.example.com/x', 't')).toBe('HTTPS://API.example.com/x?token=t');
  });
  it('never leaks the token to other origins (pre-signed URLs pass through untouched)', () => {
    const signed = 'https://storage.googleapis.com/b/o.mp3?X-Goog-Signature=abc';
    expect(mediaUrl(API, 'j1', signed, 't')).toBe(signed);
    expect(mediaUrl(API, 'j1', 'https://api.example.com.evil.io/a', 't')).toBe('https://api.example.com.evil.io/a');
    expect(mediaUrl(API, 'j1', 'https://cdn.example.com/a.mp3', 't')).toBe('https://cdn.example.com/a.mp3');
  });
  it('treats a path that is not http(s) and has no origin as relative', () => {
    expect(mediaUrl(API, 'j1', '/api/x', 't')).toBe(`${API}/api/x?token=t`);
  });
});
