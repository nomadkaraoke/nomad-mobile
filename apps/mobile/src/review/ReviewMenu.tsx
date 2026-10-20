import { Ionicons } from '@expo/vector-icons';
import { useTranslations } from '@nomad/i18n';
import { colors, Sheet } from '@nomad/ui';
import { Alert, Pressable, Text, View } from 'react-native';

import type { IconName } from './IconButton';

type Props = {
  visible: boolean;
  onClose: () => void;
  isDuet: boolean;
  onSetDuet: (on: boolean) => void;
  /** Runs only after the person confirms. */
  onDiscard: () => void;
  /** Hidden when undefined. */
  onContinueOnWeb?: () => void;
};

function Item({ testID, icon, label, danger, onPress }: { testID: string; icon: IconName; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} className="min-h-12 flex-row items-center gap-3 rounded-lg px-2">
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.text} />
      <Text className={`text-base ${danger ? 'text-danger' : 'text-text'}`}>{label}</Text>
    </Pressable>
  );
}

/** Review overflow menu (spec §4.2): Continue on web, Mark as duet / Not a duet, Discard my edits. */
export function ReviewMenu({ visible, onClose, isDuet, onSetDuet, onDiscard, onContinueOnWeb }: Props) {
  const t = useTranslations('review');

  const confirmDiscard = () => {
    onClose();
    Alert.alert(t('discardTitle'), t('discardBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('discardConfirm'), style: 'destructive', onPress: onDiscard },
    ]);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('menuTitle')} testID="review-menu-sheet" closeLabel={t('close')}>
      <View className="gap-1">
        {onContinueOnWeb ? (
          <Item
            testID="review-menu-web"
            icon="globe-outline"
            label={t('menuWeb')}
            onPress={() => {
              onClose();
              onContinueOnWeb();
            }}
          />
        ) : null}
        <Item
          testID="review-menu-duet"
          icon="people-outline"
          label={isDuet ? t('notDuet') : t('markDuet')}
          onPress={() => {
            onClose();
            onSetDuet(!isDuet);
          }}
        />
        <Item testID="review-menu-discard" icon="trash-outline" label={t('discard')} danger onPress={confirmDiscard} />
      </View>
    </Sheet>
  );
}
