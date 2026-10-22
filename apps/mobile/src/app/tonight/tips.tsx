import { useTranslations } from '@nomad/i18n';
import { Stack } from 'expo-router';

import { TipsRouteScreen } from '../../tonight/manage/TipsScreen';

/** Tip the host at tonight's Nomad night (spec §4.1 Tips). */
export default function TonightTipsRoute() {
  const t = useTranslations('tonight.manage.tips');
  return (
    <>
      <Stack.Screen options={{ title: t('title') }} />
      <TipsRouteScreen />
    </>
  );
}
