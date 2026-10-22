import { useTranslations } from '@nomad/i18n';
import { Stack, useLocalSearchParams } from 'expo-router';

import { TonightMake } from '../../tonight/make/TonightMake';

/**
 * Make on the spot inside Tonight (ruling E7-R1). Params: `artist` + `title` (search's pre-fill, E5) and `friend` (a
 * song for a friend: the request flow clears on leaving search, so the friend travels as a param).
 */
export default function TonightMakeRoute() {
  const t = useTranslations('tonight.make');
  const { artist, title, friend } = useLocalSearchParams<{ artist?: string; title?: string; friend?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: t('title') }} />
      <TonightMake artist={artist ?? ''} title={title ?? ''} friend={friend || undefined} />
    </>
  );
}
