import { midiToName, type FalsettoCandidate, type NoteLabel } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { useEffect } from 'react';
import { AccessibilityInfo, Platform, View } from 'react-native';

/**
 * The live "High note: falsetto?" chip while a song plays (Phase 3d batch 1, M7). It announces itself politely,
 * never takes focus and never touches the player; the session hides it after 5 s (an unanswered note goes to the
 * quiz). It sits in the screen's content, above the footer, so it never covers Stop early. `accessibilityLiveRegion`
 * is Android-only, so on iOS VoiceOver hears it through a queued announcement (after whatever it is reading).
 */
export function FalsettoChip({ candidate, onAnswer }: { candidate: FalsettoCandidate; onAnswer: (label: NoteLabel) => void }) {
  const t = useTranslations('voiceSession.falsetto');
  const note = isolate(midiToName(candidate.midi));
  const label = t('chipLabel', { note });
  useEffect(() => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibilityWithOptions(label, { queue: true });
  }, [label]);
  return (
    <View
      testID="vs-falsetto-chip"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      className="flex-row flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3"
    >
      <Text testID="vs-falsetto-text" className="flex-1 font-semibold">
        {t('chip', { note })}
      </Text>
      <View className="flex-row gap-2">
        <Button testID="vs-falsetto-yes" label={t('yes')} onPress={() => onAnswer('falsetto')} />
        <Button testID="vs-falsetto-no" variant="secondary" label={t('no')} onPress={() => onAnswer('full')} />
      </View>
    </View>
  );
}
