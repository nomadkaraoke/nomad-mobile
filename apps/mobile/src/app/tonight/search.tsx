import { useTranslations } from '@nomad/i18n';
import { Stack, useLocalSearchParams } from 'expo-router';

import { SearchScreen } from '../../tonight/request/SearchScreen';

/**
 * Tonight's request search. Params: `change` (request id) + `replacing` (its title) open change mode (A.39);
 * `friend` (a name) opens a song for a friend (A.10). No params: a new request for yourself.
 */
export default function TonightSearchRoute() {
  const t = useTranslations('tonight.request');
  const { change, replacing, friend } = useLocalSearchParams<{ change?: string; replacing?: string; friend?: string }>();
  const id = change !== undefined && /^\d+$/.test(change) ? Number(change) : undefined;
  return (
    <>
      <Stack.Screen options={{ title: t('title') }} />
      <SearchScreen change={id !== undefined ? { id, title: replacing ?? '' } : undefined} friend={friend || undefined} />
    </>
  );
}
