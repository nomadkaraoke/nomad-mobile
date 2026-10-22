import { View } from 'react-native';

import { LibraryFilterPicker } from '../../find/library';

/**
 * Discover's venue library picker in Tonight's add-a-song search (spec §6.2, ruling E9-R1), above the results. The
 * choice is Phase 3's shared `useLibraryFilter()` store, so it is the same filter search and Discover use.
 */
export function LibraryFilterSlot() {
  return (
    <View testID="other-add-library-slot">
      <LibraryFilterPicker />
    </View>
  );
}
