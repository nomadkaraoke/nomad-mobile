import { reasonKey, sectionTitle } from '../index';

describe('reasonKey', () => {
  it.each(['known_song', 'known_artist', 'similar_artist', 'genre_match', 'decade_match', 'crowd_pleaser', 'make_it'])(
    '%s',
    (t) => expect(reasonKey(t)).toBe(`discover.reason.${t}`),
  );
  it('falls back to crowd_pleaser', () => {
    expect(reasonKey('mystery')).toBe('discover.reason.crowd_pleaser');
    expect(reasonKey('')).toBe('discover.reason.crowd_pleaser');
    expect(reasonKey('../x')).toBe('discover.reason.crowd_pleaser');
  });
});

describe('sectionTitle', () => {
  it('maps decide title keys to app keys', () => {
    expect(sectionTitle({ title_key: 'recs.section.songs_you_know.title', title_params: {} })).toEqual({
      key: 'discover.section.songs_you_know',
      params: {},
    });
  });
  it('keeps params and maps because_<artist> to the because section', () => {
    expect(
      sectionTitle({ id: 'because_muse', title_key: 'recs.section.because.title', title_params: { artist: 'Muse' } }),
    ).toEqual({ key: 'discover.section.because', params: { artist: 'Muse' } });
  });
  it('handles missing params and unknown shapes', () => {
    expect(sectionTitle({ title_key: 'recs.section.all.title' })).toEqual({ key: 'discover.section.all', params: {} });
    expect(sectionTitle({ title_key: 'weird' })).toEqual({ key: 'discover.section.crowd_pleasers', params: {} });
  });
  it.each(['songs_you_know', 'artists_you_love', 'because', 'crowd_pleasers', 'make_it', 'all'])('knows %s', (x) => {
    expect(sectionTitle({ title_key: `recs.section.${x}.title` }).key).toBe(`discover.section.${x}`);
  });
  it('a well-formed but unknown section (decide added one) falls back to crowd_pleasers', () => {
    expect(sectionTitle({ title_key: 'recs.section.new_thing.title' }).key).toBe('discover.section.crowd_pleasers');
    // A message key that exists but is not a section title (the reason copy) is not a section either.
    expect(sectionTitle({ title_key: 'recs.section.allReason.title' }).key).toBe('discover.section.crowd_pleasers');
  });
});
