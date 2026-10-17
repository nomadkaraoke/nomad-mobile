import { Image, Text, View } from 'react-native';

import { colors } from './tokens';

export type ArtTileProps = {
  title: string;
  testID: string;
  /** Cover art, when the catalog has some. Without it the tile shows the title's initials. */
  imageUrl?: string | null;
  /** Height in points; the tile fills its parent's width. */
  height?: number;
};

// Leading punctuation and symbols a title word can start with: "(I Can't…", "“Heroes”", "#1 Crush".
const LEADING_MARKS = /^[\s"'“”‘’()[\]{}.,!?¿¡\-–—&/:;#*+]+/;

// Brand purple into half-transparent pink (80 = 50% alpha), over the dark background.
const GRADIENT = `linear-gradient(135deg, ${colors.purple}, ${colors.primary}80)`;

/** Up to two initials from the title's first words, ignoring a leading "The" and punctuation. */
export function initials(title: string): string {
  const words = title
    .split(/\s+/)
    .map((w) => w.replace(LEADING_MARKS, ''))
    .filter(Boolean);
  const meaningful = words.length > 1 && words[0]!.toLowerCase() === 'the' ? words.slice(1) : words;
  return meaningful
    .slice(0, 2)
    .map((w) => Array.from(w)[0]!.toUpperCase())
    .join('');
}

/**
 * Decorative song artwork (mockup "art" card): the cover when there is one, otherwise a purple-to-pink
 * gradient with the title's initials. Hidden from screen readers; the title is right below it.
 */
export function ArtTile({ title, testID, imageUrl, height = 160 }: ArtTileProps) {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="w-full justify-end overflow-hidden rounded-xl p-4"
      style={{ height, experimental_backgroundImage: GRADIENT }}
    >
      {imageUrl ? (
        <Image testID={`${testID}-image`} source={{ uri: imageUrl }} className="absolute inset-0" resizeMode="cover" />
      ) : (
        // An explicit left, which React Native mirrors to the right under RTL (see ./Text).
        <Text className="text-5xl font-extrabold text-text/90" style={{ textAlign: 'left' }}>
          {initials(title)}
        </Text>
      )}
    </View>
  );
}
