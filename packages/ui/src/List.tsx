import { FlashList } from '@shopify/flash-list';
import type { ReactElement } from 'react';

export type ListProps<T> = {
  data: readonly T[];
  renderItem: (item: T, index: number) => ReactElement;
  keyExtractor: (item: T) => string;
  testID: string;
  onEndReached?: () => void;
  ListEmptyComponent?: ReactElement;
  ListHeaderComponent?: ReactElement;
  ListFooterComponent?: ReactElement;
  refreshing?: boolean;
  onRefresh?: () => void;
};

/**
 * Our only list primitive. FlashList today; Shopify is winding down its stewardship, so if it
 * stalls, swap this body for LegendList/FlatList without touching any caller.
 */
export function List<T>({ data, renderItem, keyExtractor, testID, ...rest }: ListProps<T>) {
  return (
    <FlashList
      testID={testID}
      data={data}
      renderItem={({ item, index }) => renderItem(item, index)}
      keyExtractor={keyExtractor}
      onEndReachedThreshold={0.5}
      keyboardShouldPersistTaps="handled"
      {...rest}
    />
  );
}
