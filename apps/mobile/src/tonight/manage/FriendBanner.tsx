import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text, TextField } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { TonightSheet } from '../TonightSheet';

/**
 * Search's friend-mode banner (spec §4.1 Song for a friend, A.14): "Picking a song for X" with a way back to a song
 * for yourself.
 */
export function FriendBanner({ name, onCancel }: { name: string; onCancel: () => void }) {
  const t = useTranslations('tonight.manage.friend');
  return (
    <View testID="tonight-friend-banner" className="gap-1 rounded-xl border border-primary/40 bg-primary/10 p-3">
      <Text className="font-semibold">{t('banner', { name: isolate(name) })}</Text>
      <Pressable testID="tonight-friend-cancel" accessibilityRole="button" hitSlop={8} onPress={onCancel} className="min-h-11 justify-center">
        <Text className="text-sm font-semibold text-primary">{t('cancel')}</Text>
      </Pressable>
    </View>
  );
}

/** Asks for the friend's name, then starts the friend flow (A.10: its own flow, never the rename form). */
export function FriendNameSheet({
  visible,
  initialName = '',
  onClose,
  onPick,
}: {
  visible: boolean;
  initialName?: string;
  onClose: () => void;
  onPick: (name: string) => void;
}) {
  const t = useTranslations('tonight.manage.friend');
  const tManage = useTranslations('tonight.manage');
  const [name, setName] = useState(initialName);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setName(initialName);
  }
  const trimmed = name.trim();
  return (
    <TonightSheet visible={visible} onClose={onClose} title={t('title')} testID="tonight-friend-sheet" closeLabel={tManage('close')}>
      <View className="gap-3 pb-2">
        <Text variant="muted">{t('hint')}</Text>
        <TextField
          testID="tonight-friend-name"
          label={t('nameLabel')}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          returnKeyType="next"
          onSubmitEditing={() => trimmed && onPick(trimmed)}
        />
        <Button testID="tonight-friend-next" label={t('next')} disabled={!trimmed} onPress={() => onPick(trimmed)} />
      </View>
    </TonightSheet>
  );
}
