import type { SessionPatch, SessionSetup } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Sheet } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ChoiceGroup } from './screens/ChoiceGroup';
import { POSTURES, WARMTHS } from './screens/SetupScreen';

const ON_OFF = ['yes', 'no'] as const;

/**
 * The small "Standing · Cold" chip (spec §4.2): posture and warmth stay changeable mid-session, and recording can be
 * turned off (or on) from its sheet. Every change goes to `onPatch` (useVoiceSession's patchContext).
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
          <ChoiceGroup
            title={t('context.record')}
            values={ON_OFF}
            selected={setup.record ? 'yes' : 'no'}
            label={(v) => t(v === 'yes' ? 'context.on' : 'context.off')}
            onPick={(v) => (v === 'yes') !== setup.record && onPatch({ record: v === 'yes' })}
            idPrefix="vs-ctx-record"
          />
        </View>
      </Sheet>
    </>
  );
}
