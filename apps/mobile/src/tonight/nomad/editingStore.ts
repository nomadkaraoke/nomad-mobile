import { create } from 'zustand';

/**
 * True while the singer is editing their list (E6's reorder mode). The night screen pauses polling meanwhile, so
 * a refresh never moves rows under the singer's finger (spec §4.1 Reorder, A.57).
 */
export const useEditingStore = create<{
  editing: boolean;
  setEditing(editing: boolean): void;
  /**
   * Another sheet or modal is open on the night screen (a version info sheet, a preview, a friend picker…). Set it
   * while one is up: the post-song survey waits instead of stacking on top (ruling E8-R3: it never gets in the way).
   */
  sheetOpen: boolean;
  setSheetOpen(open: boolean): void;
}>((set) => ({
  editing: false,
  setEditing: (editing) => set({ editing }),
  sheetOpen: false,
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
}));
