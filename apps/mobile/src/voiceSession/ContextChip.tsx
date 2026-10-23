import type { SessionPatch, SessionSetup } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, Sheet, Text as UiText } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ChoiceGroup } from './screens/ChoiceGroup';
import { POSTURES, WARMTHS } from './setupOptions';

/**
 * The small "Standing · Cold" chip (spec §4.2): posture and warmth stay changeable mid-session. Its sheet can also
 * withdraw recording consent (off only: consent is given on the setup screen, never turned back on from here). Every
 * change goes to `onPatch` (useVoiceSession's patchContext).
 */
export function ContextChip({ setup, onPatch }: { setup: SessionSetup; onPatch: (patch: SessionPatch) => void }) {
  const t = useTranslations('voiceSession');
  const ts = useTranslations('voiceSession.setup');
  const [open, setOpen] = useState(false);
  const posture = ts(setup.posture);
  const warmth = ts(setup.warmth);
  return (
    <>
      <Pressable
        testID="vs-context-chip"
        accessibilityRole="button"
        accessibilityLabel={t('context.chipLabel', { posture, warmth })}
        onPress={() => setOpen(true)}
        className="min-h-11 justify-center rounded-full border border-border bg-card px-3"
      >
        <Text className="text-sm font-semibold text-text">{t('context.chip', { posture, warmth })}</Text>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={t('context.title')} testID="vs-context-sheet" closeLabel={t('close')}>
        <View className="gap-4 pb-2">
          <ChoiceGroup
            title={ts('posture')}
            values={POSTURES}
            selected={setup.posture}
            label={(v) => ts(v)}
            onPick={(v) => v !== setup.posture && onPatch({ posture: v })}
            idPrefix="vs-ctx-posture"
          />
          <ChoiceGroup
            title={ts('warmth')}
            values={WARMTHS}
            selected={setup.warmth}
            label={(v) => ts(v)}
            onPick={(v) => v !== setup.warmth && onPatch({ warmth: v })}
            idPrefix="vs-ctx-warmth"
          />
          {setup.record ? (
            <Button testID="vs-ctx-record-off" variant="secondary" label={t('context.recordTurnOff')} onPress={() => onPatch({ record: false })} />
          ) : (
            <UiText testID="vs-ctx-record-status" variant="muted">
              {t('context.recordOff')}
            </UiText>
          )}
        </View>
      </Sheet>
    </>
  );
}
