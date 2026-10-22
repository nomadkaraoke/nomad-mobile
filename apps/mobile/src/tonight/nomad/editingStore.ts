import { create } from 'zustand';

/**
 * True while the singer is editing their list (E6's reorder mode). The night screen pauses polling meanwhile, so
 * a refresh never moves rows under the singer's finger (spec §4.1 Reorder, A.57).
 */
export const useEditingStore = create<{ editing: boolean; setEditing(editing: boolean): void }>((set) => ({
  editing: false,
  setEditing: (editing) => set({ editing }),
}));
