import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { Linking, View } from 'react-native';

/** The box's LAN page: resolves only on the "Nomad KJ Box" wifi (A.88). */
export const LAN_SING_URL = 'http://l.kjbox.cc/';

/**
 * Spec §4.2 / ruling E4-R2: the box can't be reached. Point at the venue wifi + web page; the night screen keeps the
 * last-known Your songs below, read-only, and keeps retrying.
 */
export function Unreachable({ hasSongs }: { hasSongs: boolean }) {
  const t = useTranslations('tonight.night');
  return (
    <View testID="tonight-unreachable" className="gap-2 rounded-xl border border-danger bg-danger/10 p-4">
      <Text>{t('unreachable.message')}</Text>
      <Button testID="tonight-open-web" variant="secondary" label={t('unreachable.openWeb')} onPress={() => void Linking.openURL(LAN_SING_URL)} />
      {hasSongs ? <Text variant="muted">{t('unreachable.lastKnown')}</Text> : null}
    </View>
  );
}
