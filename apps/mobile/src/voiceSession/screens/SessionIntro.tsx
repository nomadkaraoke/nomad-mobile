import { Ionicons } from '@expo/vector-icons';
import { useTranslations } from '@nomad/i18n';
import { Button, colors, Text } from '@nomad/ui';
import { View } from 'react-native';

import { StepLayout } from '../../voice/StepLayout';
import { AnalyseMyMusicCard } from '../personal/AnalyseMyMusicCard';

/** What a session involves (spec §4.1), with Start and Not now, and "Analyse my music" when eligible. */
export function SessionIntro({ onStart, onClose }: { onStart: () => void; onClose: () => void }) {
  const t = useTranslations('voiceSession.intro');
  return (
    <StepLayout
      testID="vs-intro"
      footer={
        <>
          <Button testID="vs-intro-start" label={t('start')} onPress={onStart} />
          <Button testID="vs-intro-close" variant="secondary" label={t('close')} onPress={onClose} />
        </>
      }
    >
      <View className="items-center pt-6">
        <View className="h-24 w-24 items-center justify-center rounded-full bg-card">
          <Ionicons name="musical-notes" size={44} color={colors.primary} />
        </View>
      </View>
      <Text className="text-2xl font-bold">{t('title')}</Text>
      <Text>{t('body')}</Text>
      {/* Its songs join the session's pool: "find your voice" here is just Start. */}
      <AnalyseMyMusicCard onFindVoice={onStart} />
    </StepLayout>
  );
}
