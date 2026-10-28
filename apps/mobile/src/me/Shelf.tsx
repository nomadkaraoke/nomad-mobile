import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

export type ShelfProps = {
  testID: string;
  title: string;
  /** Shows "See all" (testID `${testID}-all`) when given. */
  onSeeAll?: () => void;
  /** Shown instead of the children when the shelf has nothing yet. */
  empty?: ReactNode;
  children?: ReactNode;
};

/** A titled block on the Me home: the title, an optional See all, then the content (or the empty state). */
export function Shelf({ testID, title, onSeeAll, empty, children }: ShelfProps) {
  const t = useTranslations('me.home');
  return (
    <View testID={testID} className="gap-2">
      <View className="flex-row items-center justify-between gap-2">
        <Text accessibilityRole="header" className="flex-1 text-lg font-bold">
          {title}
        </Text>
        {onSeeAll ? (
          <Pressable testID={`${testID}-all`} accessibilityRole="button" onPress={onSeeAll} className="min-h-11 justify-center px-1">
            <Text className="font-semibold text-primary">{t('seeAll')}</Text>
          </Pressable>
        ) : null}
      </View>
      {empty ?? children}
    </View>
  );
}
