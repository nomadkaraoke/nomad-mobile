import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { View } from 'react-native';

/** Signed in with no music profile yet, above the popular list: "Get your picks in 30 seconds". */
export function QuizCard({ onStart }: { onStart: () => void }) {
  const t = useTranslations('discover');
  return (
    <View testID="discover-quiz-card" className="gap-2 rounded-xl border border-primary/40 bg-primary/10 p-3">
      <Text className="text-lg font-semibold">{t('quizCardTitle')}</Text>
      <Text variant="muted">{t('quizCardBody')}</Text>
      <Button testID="discover-quiz-start" label={t('quizCardStart')} onPress={onStart} />
    </View>
  );
}
