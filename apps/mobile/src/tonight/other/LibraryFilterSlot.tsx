import { View } from 'react-native';

/**
 * Where Discover's venue library picker goes in Tonight's add-a-song search (spec §6.2, ruling E9-R1). Phase 3's
 * `LibraryFilterPicker` (apps/mobile/src/find/library) isn't on this branch yet; when it lands, this renders
 * `<LibraryFilterPicker/>` here, and `useSearch` reads the venue filter from Phase 3's `useLibraryFilter()` by default.
 * Until then it is an empty boundary above the results.
 */
export function LibraryFilterSlot() {
  return <View testID="other-add-library-slot" />;
}
