import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { forwardRef, useImperativeHandle, useRef, type ReactElement, type Ref } from 'react';

export type ListHandle = {
  scrollToIndex(index: number, opts?: { animated?: boolean; viewPosition?: number }): void;
};

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
  /** Re-renders rows when something outside `data` they depend on changes. */
  extraData?: unknown;
  /** Rows of different types recycle separately (cheaper for heterogeneous lists). */
  getItemType?: (item: T, index: number) => string | number | undefined;
  onScrollBeginDrag?: () => void;
  /**
   * New rows at the top stay in view instead of the list holding the old first row in place (FlashList's
   * default keeps the visible content still, so a row added at the top lands above the viewport).
   * For lists that grow at the top, e.g. the Make tab, where a job needing review sorts first.
   */
  showNewRowsAtTop?: boolean;
};

/**
 * Our only list primitive. FlashList today; Shopify is winding down its stewardship, so if it
 * stalls, swap this body for LegendList/FlatList without touching any caller.
 */
function ListInner<T>(
  { data, renderItem, keyExtractor, testID, showNewRowsAtTop, ...rest }: ListProps<T>,
  ref: Ref<ListHandle>,
) {
  const listRef = useRef<FlashListRef<T>>(null);
  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index, opts) => {
        listRef.current
          ?.scrollToIndex({ index, animated: opts?.animated, viewPosition: opts?.viewPosition })
          .catch(() => {});
      },
    }),
    [],
  );
  return (
    <FlashList
      ref={listRef}
      testID={testID}
      data={data}
      renderItem={({ item, index }) => renderItem(item, index)}
      keyExtractor={keyExtractor}
      onEndReachedThreshold={0.5}
      keyboardShouldPersistTaps="handled"
      maintainVisibleContentPosition={showNewRowsAtTop ? { disabled: true } : undefined}
      {...rest}
    />
  );
}

export const List = forwardRef(ListInner) as <T>(props: ListProps<T> & { ref?: Ref<ListHandle> }) => ReactElement;
