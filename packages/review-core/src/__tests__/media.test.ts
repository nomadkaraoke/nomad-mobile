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
  it('keeps absolute URLs', () => {
    expect(mediaUrl(API, 'j1', 'https://cdn.example.com/a.mp3', 't')).toBe('https://cdn.example.com/a.mp3?token=t');
  });
});
