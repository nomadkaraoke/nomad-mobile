import { render, screen } from '@testing-library/react-native';

import { BrandIcon, type BrandId } from '../BrandIcon';

const BRANDS: BrandId[] = ['spotify', 'apple_music', 'youtube_music', 'lastfm', 'listenbrainz'];

describe('BrandIcon', () => {
  it.each(BRANDS)('renders the %s mark with a default testID, hidden from accessibility', (brand) => {
    render(<BrandIcon brand={brand} />);
    const icon = screen.getByTestId(`brand-icon-${brand}`, { includeHiddenElements: true });
    expect(icon.props.accessibilityElementsHidden).toBe(true);
    expect(screen.getAllByTestId('skia-path', { includeHiddenElements: true }).length).toBeGreaterThan(0);
  });

  it('uses the given testID and size (default 20)', () => {
    const { rerender } = render(<BrandIcon brand="lastfm" testID="x" />);
    expect(screen.getByTestId('x', { includeHiddenElements: true })).toHaveStyle({ width: 20, height: 20 });
    rerender(<BrandIcon brand="lastfm" testID="x" size={32} />);
    expect(screen.getByTestId('x', { includeHiddenElements: true })).toHaveStyle({ width: 32, height: 32 });
  });

  it('draws each brand in its brand colour', () => {
    const colorsOf = (brand: BrandId) => {
      const { unmount } = render(<BrandIcon brand={brand} />);
      const c = screen.getAllByTestId('skia-path', { includeHiddenElements: true }).map((p) => p.props.color);
      unmount();
      return c;
    };
    expect(colorsOf('spotify')).toContain('#1DB954');
    expect(colorsOf('apple_music')).toContain('#FA243C');
    expect(colorsOf('youtube_music')).toContain('#FF0000');
    expect(colorsOf('lastfm')).toContain('#D51007');
    expect(colorsOf('listenbrainz')).toEqual(expect.arrayContaining(['#353070', '#EB743B']));
  });
});
