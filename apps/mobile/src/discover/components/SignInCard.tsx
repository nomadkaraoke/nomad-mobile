import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { View } from 'react-native';

/** Signed out, above the popular list: "Sign in to get your picks". */
export function SignInCard({ onSignIn }: { onSignIn: () => void }) {
  const t = useTranslations('discover');
  return (
    <View testID="discover-signin-card" className="gap-2 rounded-xl border border-primary/40 bg-primary/10 p-3">
      <Text className="text-lg font-semibold">{t('signInForPicks')}</Text>
      <Text variant="muted">{t('signInForPicksBody')}</Text>
      <Button testID="discover-signin" label={t('signInForPicksAction')} onPress={onSignIn} />
    </View>
  );
}
