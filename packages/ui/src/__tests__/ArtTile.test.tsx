import { render, screen } from '@testing-library/react-native';

import { ArtTile, initials } from '../ArtTile';

// The tile is decorative (hidden from screen readers), so queries must include hidden elements.
const H = { includeHiddenElements: true };

it('initials: first letters of the first two words, skipping punctuation and "The"', () => {
  expect(initials('Starlight')).toBe('S');
  expect(initials('Mr. Brightside')).toBe('MB');
  expect(initials('The Killers')).toBe('K');
  expect(initials('(I Can’t Get No) Satisfaction')).toBe('IC');
  expect(initials('  ')).toBe('');
  expect(initials('أهلا بك')).toBe('أب');
});

it('renders the title initials on a decorative tile, hidden from screen readers', () => {
  render(<ArtTile testID="art" title="Mr. Brightside" />);
  expect(screen.getByTestId('art', H)).toHaveTextContent('MB');
  expect(screen.getByTestId('art', H).props.accessibilityElementsHidden).toBe(true);
  expect(screen.getByTestId('art', H).props.importantForAccessibility).toBe('no-hide-descendants');
});

it('shows an image instead of initials when one is given', () => {
  render(<ArtTile testID="art" title="Starlight" imageUrl="https://example.com/a.jpg" />);
  expect(screen.getByTestId('art-image', H).props.source).toEqual({ uri: 'https://example.com/a.jpg' });
  expect(screen.queryByText('S', H)).toBeNull();
});
