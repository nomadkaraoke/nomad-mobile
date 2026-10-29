import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ClaimNightCard } from './ClaimNightCard';
import { useClaimNightsView } from './useClaimNightsView';

/** Me shows at most this many nights; the rest are on /me/past-nights (R40). */
const MAX = 2;

/**
 * "Were these you?" on the Me home (spec §6.10, slot §6.5.2): past Nomad nights with songs sung under a name like the
 * account's. Renders nothing without suggestions, which includes the box being unreachable, an older box, offline
 * and signed out.
 */
export function ClaimNightsSection() {
  const t = useTranslations('me.claim');
  const v = useClaimNightsView();
  if (v.rows.length === 0) return null;
  return (
    <View testID="me-claim" className="gap-2">
      <Text accessibilityRole="header" className="text-lg font-bold">
        {t('title')}
      </Text>
      <Text variant="muted">{t('explainer')}</Text>
      {v.rows.slice(0, MAX).map((r, i) => (
        <ClaimNightCard
          key={r.night.night_id}
          prefix="me-claim"
          index={i}
          night={r.night}
          saved={r.saved}
          unticked={r.unticked}
          status={r.status}
          offline={v.offline}
          onToggle={(id) => v.toggle(r.night.night_id, id)}
          onSave={() => void v.save(r.night)}
          onNone={() => void v.none(r.night)}
        />
      ))}
      {v.rows.length > MAX || v.more > 0 ? (
        <Pressable
          testID="me-claim-all"
          accessibilityRole="button"
          onPress={() => router.push('/me/past-nights' as Href)}
          className="min-h-11 justify-center px-1"
        >
          <Text className="font-semibold text-primary">{t('seeAll', { count: v.total })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
