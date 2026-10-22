import { create } from 'zustand';

/**
 * True while the singer is editing their list (E6's reorder mode). The night screen pauses polling meanwhile, so
 * a refresh never moves rows under the singer's finger (spec §4.1 Reorder, A.57).
 */
export const useEditingStore = create<{
  editing: boolean;
  setEditing(editing: boolean): void;
  /**
   * How many Tonight sheets or modals are open (a version info sheet, a preview, a friend picker…). Maintained by
   * `useSheetPresence` / `TonightSheet` (tonight/TonightSheet.tsx), never by hand: the post-song survey waits while
   * any is up instead of stacking on top (ruling E8-R3: it never gets in the way).
   */
  sheets: number;
  openSheet(): void;
  closeSheet(): void;
}>((set) => ({
  editing: false,
  setEditing: (editing) => set({ editing }),
  sheets: 0,
  openSheet: () => set((s) => ({ sheets: s.sheets + 1 })),
  closeSheet: () => set((s) => ({ sheets: Math.max(0, s.sheets - 1) })),
}));
