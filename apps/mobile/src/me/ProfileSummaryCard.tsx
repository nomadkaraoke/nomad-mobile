import type { MeSong } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { BrandIcon, colors, PianoStrip, StartText, Text, type BrandId } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { brandFor } from '../discover/connect/ConnectedSources';
import { useServicesSummary } from '../discover/connect/queries';
import { useVoiceProfile } from '../voice/useVoiceProfile';
import { noteRange, useVoiceLabels } from '../voice/voiceLabels';
import { stripBounds } from '../voice/VoiceResult';

const go = (href: string) => () => router.push(href as Href);

function Cta({ testID, title, hint, onPress }: { testID: string; title: string; hint: string; onPress: () => void }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      onPress={onPress}
      className="min-h-11 flex-row items-center justify-between gap-2 rounded-lg border border-dashed border-primary px-3 py-2"
    >
      <View className="flex-1">
        <Text className="font-semibold text-primary">{title}</Text>
        <Text variant="muted">{hint}</Text>
      </View>
      <Text importantForAccessibility="no" className="text-lg text-primary">
        {'›'}
      </Text>
    </Pressable>
  );
}

/**
 * The top of Me: a compact music profile (voice range, connected sources, counts) with Manage. Anything not set up
 * yet is a button straight into its setup (voice test, Connect), so the profile is easy to find and finish.
 */
export function ProfileSummaryCard({ items }: { items: MeSong[] }) {
  const t = useTranslations('me.home');
  const labels = useVoiceLabels();
  const { profile } = useVoiceProfile();
  const summary = useServicesSummary();
  const connected = useMemo(() => (summary.data?.sources ?? []).filter((s) => s.connected), [summary.data]);
  const brands = useMemo(() => [...new Set(connected.map((s) => brandFor(s.source)).filter((b): b is BrandId => b !== null))], [connected]);
  const sung = items.filter((s) => s.times_sung > 0).length;
  const saved = items.filter((s) => s.loved).length;

  let strip = null;
  if (profile) {
    const [lo, hi] = stripBounds(profile.lowMidi, profile.highMidi);
    const marks = [];
    for (let m = profile.lowMidi; m <= profile.highMidi; m++) {
      marks.push({ midi: m, color: m >= profile.comfortLow && m <= profile.comfortHigh ? colors.gold : colors.primary });
    }
    strip = (
      <View className="gap-1">
        <View className="flex-row items-baseline justify-between gap-2">
          <Text testID="me-profile-voice-type" className="flex-1 font-semibold" numberOfLines={1}>
            {labels.likely(profile)}
          </Text>
          <StartText className="text-primary">{t('voiceRange', { range: noteRange(profile.lowMidi, profile.highMidi) })}</StartText>
        </View>
        <PianoStrip testID="me-profile-keys" lowMidi={lo} highMidi={hi} height={28} marks={marks} accessibilityLabel={t('keysLabel')} />
      </View>
    );
  }

  return (
    <View testID="me-profile-card" className="gap-3 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text accessibilityRole="header" className="flex-1 text-lg font-bold">
          {t('profileTitle')}
        </Text>
        <Pressable
          testID="me-profile-manage"
          accessibilityRole="button"
          accessibilityLabel={t('manage')}
          accessibilityHint={t('manageHint')}
          onPress={go('/me/music-profile')}
          className="min-h-11 justify-center rounded-full border border-primary px-4"
        >
          <Text className="font-semibold text-primary">{t('manage')}</Text>
        </Pressable>
      </View>
      {strip ?? <Cta testID="me-profile-voice-cta" title={t('voiceCta')} hint={t('voiceHint')} onPress={go('/discover/voice')} />}
      {connected.length > 0 ? (
        <View testID="me-profile-sources" accessibilityLabel={t('sourcesLabel')} className="flex-row flex-wrap items-center gap-2">
          {brands.map((b) => (
            <BrandIcon key={b} brand={b} size={24} testID={`me-profile-source-${b}`} />
          ))}
        </View>
      ) : summary.data ? (
        <Cta testID="me-profile-connect" title={t('connectCta')} hint={t('connectHint')} onPress={go('/discover/connect')} />
      ) : null}
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <Text testID="me-profile-sung" variant="muted">
          {t('sung', { count: sung })}
        </Text>
        <Text testID="me-profile-saved" variant="muted">
          {t('saved', { count: saved })}
        </Text>
      </View>
    </View>
  );
}
