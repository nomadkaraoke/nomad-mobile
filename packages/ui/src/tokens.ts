// Mirrors karaoke-gen/frontend/app/globals.css and apps/mobile/global.css @theme.
// Use classNames for styling; these are for non-className consumers (Skia paints, navigation theme).
export const colors = {
  bg: '#0f0f0f',
  card: '#1a1a1a',
  border: '#2a2a2a',
  text: '#e5e5e5',
  muted: '#888888',
  primary: '#ff7acc',
  // Gen web puts white on pink (2.4:1, below WCAG AA). The app uses near-black (8.1:1) for legibility.
  primaryFg: '#0f0f0f',
  gold: '#ffdf6b',
  purple: '#8b5cf6',
  danger: '#ef4444',
  success: '#22c55e',
  waveform: '#0d1117',
} as const;
