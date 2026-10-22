import type { MeProfile } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { NomadNight } from '../nightStore';
import { FriendNameSheet } from './FriendBanner';
import { PhoneSheet, useStoredPhone } from './PhoneSheet';
import { RenameSheet } from './RenameSheet';

/** Opens the request flow for a friend (A.10, A.14). */
export const openFriendFlow = (name: string) => router.push({ pathname: '/tonight/search', params: { friend: name } });

export type MyNightPanelProps = {
  night: NomadNight;
  userKey: string | null;
  profile: MeProfile | null;
  /** The singer has live songs of their own (phone goes through PUT /me now, not with the next request). */
  hasOwnSongs: boolean;
  /** GET /night features.tips. */
  tips: boolean;
  notify: (text: string) => void;
};

/**
 * The singer's own settings for tonight under Your songs: name (with the rename guard), "Text me when I'm up", a song
 * for a friend and tipping the host (spec §4.1 Name, Phone / SMS, Song for a friend, Tips).
 */
export function MyNightPanel({ night, userKey, profile, hasOwnSongs, tips, notify }: MyNightPanelProps) {
  const t = useTranslations('tonight.manage');
  const phone = useStoredPhone(userKey) ?? profile?.phone ?? null;
  const [sheet, setSheet] = useState<'name' | 'phone' | 'friend' | null>(null);
  const name = profile?.name ?? '';
  const close = () => setSheet(null);

  return (
    <View testID="tonight-my-night" className="gap-2">
      {name ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <Text testID="tonight-singing-as">{t('name.singingAs', { name: isolate(name) })}</Text>
          <Pressable testID="tonight-edit-name" accessibilityRole="button" hitSlop={8} onPress={() => setSheet('name')} className="min-h-11 justify-center">
            <Text className="text-sm font-semibold text-primary">{t('name.edit')}</Text>
          </Pressable>
        </View>
      ) : null}
      {phone ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <Text testID="tonight-phone-status" variant="muted" className="flex-1">
            {hasOwnSongs ? t('phone.status', { phone: isolate(phone) }) : t('phone.statusNext', { phone: isolate(phone) })}
          </Text>
          <Pressable testID="tonight-phone-change" accessibilityRole="button" hitSlop={8} onPress={() => setSheet('phone')} className="min-h-11 justify-center">
            <Text className="text-sm font-semibold text-primary">{t('phone.change')}</Text>
          </Pressable>
        </View>
      ) : (
        <Button testID="tonight-phone-add" variant="secondary" label={t('phone.add')} onPress={() => setSheet('phone')} />
      )}
      <Button testID="tonight-friend-open" variant="secondary" label={t('friend.open')} onPress={() => setSheet('friend')} />
      {tips ? <Button testID="tonight-tips-open" variant="secondary" label={t('tips.open')} onPress={() => router.push('/tonight/tips')} /> : null}

      <RenameSheet
        visible={sheet === 'name'}
        night={night}
        userKey={userKey}
        currentName={name}
        onClose={close}
        onSaved={() => notify(t('name.saved'))}
        onFriend={openFriendFlow}
      />
      <PhoneSheet visible={sheet === 'phone'} night={night} userKey={userKey} hasOwnSongs={hasOwnSongs} onClose={close} />
      <FriendNameSheet
        visible={sheet === 'friend'}
        onClose={close}
        onPick={(n) => {
          close();
          openFriendFlow(n);
        }}
      />
    </View>
  );
}
