import { useTranslations } from '@nomad/i18n';
import { List, Text } from '@nomad/ui';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { ClaimNightCard } from '../../me/ClaimNightCard';
import { useClaimNightsView, type ClaimNightRow } from '../../me/useClaimNightsView';

/** Me → Were these you? → See all: every past Nomad night with songs to claim (spec §6.10, R40). */
export default function PastNightsScreen() {
  const t = useTranslations('me.claim');
  const v = useClaimNightsView();
  const empty = !v.loading && v.rows.length === 0;

  // Every night answered (or nothing to show, e.g. the box went away): back to Me.
  useEffect(() => {
    if (!empty) return;
    if (router.canGoBack()) router.back();
    else router.replace('/me');
  }, [empty]);

  const header = (
    <View className="gap-2 pb-3">
      <Text variant="muted">{t('explainer')}</Text>
      {v.more > 0 ? (
        <Text testID="me-past-nights-recent" variant="muted">
          {t('showingRecent', { count: v.rows.length })}
        </Text>
      ) : null}
    </View>
  );
  return (
    <View testID="me-past-nights" className="flex-1 bg-bg px-4 pt-4">
      <List<ClaimNightRow>
        testID="me-past-nights-list"
        data={v.rows}
        keyExtractor={(r) => r.night.night_id}
        extraData={v}
        ListHeaderComponent={header}
        renderItem={(r, i) => (
          <View className="pb-3">
            <ClaimNightCard
              prefix="me-past"
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
          </View>
        )}
      />
    </View>
  );
}
