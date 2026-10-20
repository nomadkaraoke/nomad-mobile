import { View, Text } from 'react-native';

import { IconButton } from './IconButton';

/** Native header title: the song title over its artist, both truncated to one line. */
export function ReviewHeaderTitle({ title, artist }: { title?: string; artist?: string }) {
  return (
    <View testID="review-header-title" className="max-w-56">
      {title ? (
        <Text numberOfLines={1} className="text-center text-base font-bold text-text">
          {title}
        </Text>
      ) : null}
      {artist ? (
        <Text numberOfLines={1} className="text-center text-xs text-muted">
          {artist}
        </Text>
      ) : null}
    </View>
  );
}

type ButtonsProps = {
  canUndo: boolean;
  onUndo: () => void;
  onMenu: () => void;
  /** Already translated. */
  undoLabel: string;
  menuLabel: string;
};

/**
 * Native header right: Undo and the overflow menu. Rendered by the navigator, outside the review store's
 * provider, so it takes plain props.
 */
export function ReviewHeaderButtons({ canUndo, onUndo, onMenu, undoLabel, menuLabel }: ButtonsProps) {
  return (
    <View className="flex-row items-center">
      <IconButton testID="review-undo" icon="arrow-undo" label={undoLabel} disabled={!canUndo} onPress={onUndo} />
      <IconButton testID="review-menu" icon="ellipsis-horizontal-circle" label={menuLabel} onPress={onMenu} />
    </View>
  );
}
