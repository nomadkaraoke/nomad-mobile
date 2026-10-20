import { I18nManager } from 'react-native';

import type { IconName } from './IconButton';

/** Icons that point along the reading direction, and their mirror image. */
const MIRROR: Partial<Record<IconName, IconName>> = {
  'arrow-forward': 'arrow-back',
  'arrow-back': 'arrow-forward',
  'chevron-forward': 'chevron-back',
  'chevron-back': 'chevron-forward',
  'arrow-undo': 'arrow-redo',
  'arrow-redo': 'arrow-undo',
};

/**
 * The icon to draw for a direction-bearing glyph: React Native mirrors layouts in RTL but not icon glyphs,
 * so "next" / "forward" / "undo" are swapped for their mirror image there. Media transport icons (play,
 * play-back) are not mirrored: the player bar stays left to right in every language.
 */
export function directionalIcon(icon: IconName, rtl: boolean = I18nManager.isRTL): IconName {
  return rtl ? (MIRROR[icon] ?? icon) : icon;
}
