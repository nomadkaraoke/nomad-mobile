import { identifyKind } from '../kind';

// decide tests/unit/song_search/test_identify_kind.py (kjbox test_identify_kinds).
describe('identifyKind', () => {
  it.each([
    ['rihanna push up on me', 'Rihanna', 'Push Up On Me', 'cosmetic'],
    ['Rihanna Push Up On Me', 'Rihanna', 'Push Up On Me', 'same'],
    ['espresso', 'Sabrina Carpenter', 'Espresso', 'completed'],
    ['the stokes max picu', 'The Strokes', 'Machu Picchu', 'content'],
    ['Push Up On Me Rihanna', 'Rihanna', 'Push Up On Me', 'same'],
    ['Rihanna - Push Up On Me', 'Rihanna', 'Push Up On Me', 'same'],
    ['  Push Up On Me - Rihanna  ', 'Rihanna', 'Push Up On Me', 'same'],
    ['push up on me, rihanna!', 'Rihanna', 'Push Up On Me', 'cosmetic'],
    ['party in the usa miley cyrus', 'Miley Cyrus', 'Party in the U.S.A.', 'cosmetic'],
    ['seal kiss', 'Seal', 'Kiss from a Rose', 'completed'],
    ['strokes adults are talking', 'The Strokes', 'The Adults Are Talking', 'completed'],
    ['starlite muse', 'Muse', 'Starlight', 'content'],
    ['rihanna breaking dishes', 'Rihanna', "Breakin' Dishes", 'content'],
    ['', 'Muse', 'Starlight', 'content'],
  ])('%j vs %s - %s → %s', (q, artist, title, kind) => {
    expect(identifyKind(q, artist, title)).toBe(kind);
  });
});
