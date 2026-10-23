import { Ionicons } from '@expo/vector-icons';
import { useTranslations } from '@nomad/i18n';
import { colors } from '@nomad/ui';
import { router } from 'expo-router';
import { I18nManager, Pressable } from 'react-native';

/**
 * The Connect hub's back button. The hub is the first screen of the Connect group's own stack, and the root stack
 * hides its header for the group, so no native back chevron appears there: without this the hub was a dead end
 * (the screens after it get the nested stack's chevron).
 */
export function ConnectHubBack() {
  const t = useTranslations('connect');
  return (
    <Pressable
      testID="connect-hub-back"
      accessibilityRole="button"
      accessibilityLabel={t('back')}
      hitSlop={8}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/discover'))}
      className="min-h-11 min-w-11 items-center justify-center"
    >
      <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.primary} />
    </Pressable>
  );
}
