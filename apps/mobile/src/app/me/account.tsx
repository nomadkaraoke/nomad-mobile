import { getMe } from '@nomad/api-gen';
import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

import { useAuth } from '../../auth/store';

/**
 * Me → Account and notifications: a simple list of account settings (signed-in only). "Delete account" shows only
 * when gen offers it (`capabilities.account_deletion`); keep new rows in this list.
 */
export default function AccountScreen() {
  const t = useTranslations('settings.account');
  const tDelete = useTranslations('deleteAccount');
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  const me = useQuery({ queryKey: ['me', email], queryFn: getMe, enabled: email !== null });
  return (
    <Screen testID="account-screen" scroll>
      <Text variant="title">{t('title')}</Text>
      <Button
        testID="account-notifications"
        label={t('notifications')}
        variant="secondary"
        onPress={() => router.push('/me/notifications')}
      />
      {me.data?.capabilities?.accountDeletion ? (
        <Button
          testID="account-delete"
          label={tDelete('row')}
          variant="secondary"
          onPress={() => router.push('/me/delete-account')}
        />
      ) : null}
    </Screen>
  );
}
