import { Ionicons } from '@expo/vector-icons';
import { useTranslations } from '@nomad/i18n';
import { colors, Sheet } from '@nomad/ui';
import { useCallback, useEffect, useRef } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';

import type { IconName } from './IconButton';

/** "Discard your edits?" confirm, shared by the menu and the restored-draft banner. */
export function useConfirmDiscard(): (onDiscard: () => void) => void {
  const t = useTranslations('review');
  return (onDiscard) =>
    Alert.alert(t('discardTitle'), t('discardBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('discardConfirm'), style: 'destructive', onPress: onDiscard },
    ]);
}

type Props = {
  visible: boolean;
  onClose: () => void;
  isDuet: boolean;
  onSetDuet: (on: boolean) => void;
  /** Runs only after the person confirms. */
  onDiscard: () => void;
  /** Hidden when undefined. */
  onContinueOnWeb?: () => void;
  /** Saving or submitted: the duet flag and discard are disabled (the edits were sent). */
  locked?: boolean;
};

type ItemProps = { testID: string; icon: IconName; label: string; danger?: boolean; disabled?: boolean; onPress: () => void };

function Item({ testID, icon, label, danger, disabled, onPress }: ItemProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 flex-row items-center gap-3 rounded-lg px-2 ${disabled ? 'opacity-50' : ''}`}
    >
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.text} />
      <Text className={`text-base ${danger ? 'text-danger' : 'text-text'}`}>{label}</Text>
    </Pressable>
  );
}

/** Review overflow menu (spec §4.2): Continue on web, Mark as duet / Not a duet, Discard my edits. */
export function ReviewMenu({ visible, onClose, isDuet, onSetDuet, onDiscard, onContinueOnWeb, locked = false }: Props) {
  const t = useTranslations('review');
  const confirmDiscard = useConfirmDiscard();
  // An action that presents something (the discard Alert) waits until the sheet has gone: iOS drops an
  // Alert raised while a Modal is still dismissing. iOS runs it from the Modal's onDismiss; Android
  // has no onDismiss, so it runs once the sheet is hidden.
  const pendingRef = useRef<(() => void) | null>(null);
  const runPending = useCallback(() => {
    const action = pendingRef.current;
    pendingRef.current = null;
    action?.();
  }, []);

  useEffect(() => {
    if (!visible && Platform.OS !== 'ios') runPending();
  }, [visible, runPending]);

  const closeThen = (action: () => void) => {
    pendingRef.current = action;
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onDismiss={runPending}
      title={t('menuTitle')}
      testID="review-menu-sheet"
      closeLabel={t('close')}
    >
      <View className="gap-1">
        {onContinueOnWeb ? (
          <Item
            testID="review-menu-web"
            icon="globe-outline"
            label={t('menuWeb')}
            // Opens the in-app browser: like the Alert, wait until the sheet has gone.
            onPress={() => closeThen(onContinueOnWeb)}
          />
        ) : null}
        <Item
          testID="review-menu-duet"
          icon="people-outline"
          label={isDuet ? t('notDuet') : t('markDuet')}
          disabled={locked}
          onPress={() => {
            onClose();
            onSetDuet(!isDuet);
          }}
        />
        <Item
          testID="review-menu-discard"
          icon="trash-outline"
          label={t('discard')}
          danger
          disabled={locked}
          onPress={() => closeThen(() => confirmDiscard(onDiscard))}
        />
      </View>
    </Sheet>
  );
}
