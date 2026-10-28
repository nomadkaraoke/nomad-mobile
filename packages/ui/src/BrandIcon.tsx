import { Canvas, Group, Path } from '@shopify/react-native-skia';
import { View } from 'react-native';

export type BrandId = 'spotify' | 'apple_music' | 'youtube_music' | 'lastfm' | 'listenbrainz';

// Glyph path data (24 x 24 viewBox) for Spotify, Apple Music, YouTube Music and Last.fm is from simple-icons
// v16.36.0 (CC0 1.0), https://github.com/simple-icons/simple-icons. Brand colours are the brand hexes, except
// Spotify, which uses Spotify's official green (#1DB954) rather than simple-icons' lighter #1ED760.
// simple-icons has no ListenBrainz icon, so that one is our own "LB" monogram on a tile in MetaBrainz's
// ListenBrainz purple (#353070) and orange (#EB743B), not their official logo.
// Style: one coloured mark per brand (no tile) except Apple Music and ListenBrainz, which are rounded tiles
// with a white / orange glyph, as their real marks are tiles.
const SPOTIFY = 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z';
const APPLE_MUSIC = 'M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 00-1.877-.726 10.496 10.496 0 00-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408-.056.392-.088.785-.1 1.18 0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03a12.5 12.5 0 001.57-.1c.822-.106 1.596-.35 2.295-.81a5.046 5.046 0 001.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.045-1.773-.6-1.943-1.536a1.88 1.88 0 011.038-2.022c.323-.16.67-.25 1.018-.324.378-.082.758-.153 1.134-.24.274-.063.457-.23.51-.516a.904.904 0 00.02-.193c0-1.815 0-3.63-.002-5.443a.725.725 0 00-.026-.185c-.04-.15-.15-.243-.304-.234-.16.01-.318.035-.475.066-.76.15-1.52.303-2.28.456l-2.325.47-1.374.278c-.016.003-.032.01-.048.013-.277.077-.377.203-.39.49-.002.042 0 .086 0 .13-.002 2.602 0 5.204-.003 7.805 0 .42-.047.836-.215 1.227-.278.64-.77 1.04-1.434 1.233-.35.1-.71.16-1.075.172-.96.036-1.755-.6-1.92-1.544-.14-.812.23-1.685 1.154-2.075.357-.15.73-.232 1.108-.31.287-.06.575-.116.86-.177.383-.083.583-.323.6-.714v-.15c0-2.96 0-5.922.002-8.882 0-.123.013-.25.042-.37.07-.285.273-.448.546-.518.255-.066.515-.112.774-.165.733-.15 1.466-.296 2.2-.444l2.27-.46c.67-.134 1.34-.27 2.01-.403.22-.043.442-.088.663-.106.31-.025.523.17.554.482.008.073.012.148.012.223.002 1.91.002 3.822 0 5.732z';
const YOUTUBE_MUSIC = 'M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 19.104c-3.924 0-7.104-3.18-7.104-7.104S8.076 4.896 12 4.896s7.104 3.18 7.104 7.104-3.18 7.104-7.104 7.104zm0-13.332c-3.432 0-6.228 2.796-6.228 6.228S8.568 18.228 12 18.228s6.228-2.796 6.228-6.228S15.432 5.772 12 5.772zM9.684 15.54V8.46L15.816 12l-6.132 3.54z';
const LASTFM = 'M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z';
// Rounded 24 x 24 tile (radius 5.5) and the Apple Music note's white backing.
const TILE = 'M5.5 0h13A5.5 5.5 0 0 1 24 5.5v13a5.5 5.5 0 0 1-5.5 5.5h-13A5.5 5.5 0 0 1 0 18.5v-13A5.5 5.5 0 0 1 5.5 0z';
const APPLE_BACKING = 'M6.5 1.5h11a5 5 0 0 1 5 5v11a5 5 0 0 1-5 5h-11a5 5 0 0 1-5-5v-11a5 5 0 0 1 5-5z';
// "L" and "B" as strokes.
const LB_L = 'M6.5 6v12h4.5';
const LB_B = 'M13.5 6v12h3a3 3 0 0 0 0-6h-3h2.6a3 3 0 0 0 0-6z';

type Layer = { d: string; color: string; stroke?: number };
const LAYERS: Record<BrandId, readonly Layer[]> = {
  spotify: [{ d: SPOTIFY, color: '#1DB954' }],
  apple_music: [
    { d: APPLE_BACKING, color: '#FFFFFF' },
    { d: APPLE_MUSIC, color: '#FA243C' },
  ],
  youtube_music: [{ d: YOUTUBE_MUSIC, color: '#FF0000' }],
  lastfm: [{ d: LASTFM, color: '#D51007' }],
  listenbrainz: [
    { d: TILE, color: '#353070' },
    { d: LB_L, color: '#EB743B', stroke: 2.2 },
    { d: LB_B, color: '#EB743B', stroke: 2.2 },
  ],
};

/** A music service's logo mark, `size` px square (decorative: the service's name is always next to it). */
export function BrandIcon({ brand, size = 20, testID }: { brand: BrandId; size?: number; testID?: string }) {
  return (
    <View
      testID={testID ?? `brand-icon-${brand}`}
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Canvas style={{ width: size, height: size }}>
        <Group transform={[{ scale: size / 24 }]}>
          {LAYERS[brand].map((l) => (
            <Path
              key={l.d}
              path={l.d}
              color={l.color}
              style={l.stroke ? 'stroke' : 'fill'}
              strokeWidth={l.stroke}
              strokeJoin="round"
              strokeCap="round"
            />
          ))}
        </Group>
      </Canvas>
    </View>
  );
}
