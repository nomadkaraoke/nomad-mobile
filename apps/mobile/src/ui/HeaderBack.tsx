import { Ionicons } from '@expo/vector-icons';
import { useTranslations } from '@nomad/i18n';
import { colors } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { I18nManager, Pressable } from 'react-native';

/**
 * A header back button for a screen that can be the first in its stack: the Connect hub always is (the root stack
 * hides its header for the Connect group), and any screen opened cold (a deep link, a reminder tap, an OAuth
 * return, Android share) is too. There the native stack draws no chevron, so the screen was a dead end. Goes back
 * when there is somewhere to go, else to `fallback`.
 */
export function HeaderBack({ fallback, testID }: { fallback: Href; testID: string }) {
  // The shared "Back" label (connect.back) wherever this is used.
  const t = useTranslations('connect');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('back')}
      hitSlop={8}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
      className="min-h-11 min-w-11 items-center justify-center"
    >
      <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.primary} />
    </Pressable>
  );
}

type ScreenOptionsArgs = { route: { key: string }; navigation: { getState(): { routes: readonly { key: string }[] } } };

/**
 * Screen options for a screen that is usually pushed but can be opened cold: a HeaderBack `headerLeft` only while
 * the screen is the first in its own stack, so a pushed screen keeps the native chevron and swipe-back. (The
 * `canGoBack` that `headerLeft` receives is no use here: in a nested stack it is true whenever the parent stack can
 * go back, yet the native header still draws no chevron on the nested stack's first screen.)
 */
export function headerBackWhenFirst(fallback: Href, testID: string) {
  return ({ route, navigation }: ScreenOptionsArgs) =>
    navigation.getState().routes[0]?.key === route.key
      ? { headerLeft: () => <HeaderBack fallback={fallback} testID={testID} /> }
      : {};
}
