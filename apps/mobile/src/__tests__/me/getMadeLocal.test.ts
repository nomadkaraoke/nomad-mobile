// Get this made's session state: when a restored (undone) row stops being pinned.
import type { GetMadeItem } from '@nomad/api-decide';

import { useGetMadeLocal } from '../../me/getMadeLocal';

const item = { key: 'k_One', artist: 'A', title: 'One', weight: 1 } as unknown as GetMadeItem;

beforeEach(() => useGetMadeLocal.getState().clear());

describe('getMadeLocal.settle', () => {
  it('keeps an undone row pinned for a fetch that started before its undo was sent, and drops it after', () => {
    const s = useGetMadeLocal.getState();
    s.setDismissed(item, true);
    s.setDismissed(item, false);
    s.markSent('k_One', 1_000);
    useGetMadeLocal.getState().settle(new Set(), 999); // started before the undo reached decide
    expect(useGetMadeLocal.getState().dismissed.k_One).toBeTruthy();
    useGetMadeLocal.getState().settle(new Set(), 1_000); // same instant: not after
    expect(useGetMadeLocal.getState().dismissed.k_One).toBeTruthy();
    useGetMadeLocal.getState().settle(new Set(), 1_001); // started after: decide's list is authoritative
    expect(useGetMadeLocal.getState().dismissed.k_One).toBeUndefined();
  });

  it('an unsent undo stays pinned until the server lists the row again', () => {
    const s = useGetMadeLocal.getState();
    s.setDismissed(item, true);
    s.setDismissed(item, false);
    useGetMadeLocal.getState().settle(new Set(), 5_000);
    expect(useGetMadeLocal.getState().dismissed.k_One).toBeTruthy();
    useGetMadeLocal.getState().settle(new Set(['k_One']), 5_000);
    expect(useGetMadeLocal.getState().dismissed.k_One).toBeUndefined();
  });

  it('a dismissed row is never dropped by settle', () => {
    useGetMadeLocal.getState().setDismissed(item, true);
    useGetMadeLocal.getState().settle(new Set(['k_One']), 9_999);
    expect(useGetMadeLocal.getState().dismissed.k_One?.dismissed).toBe(true);
  });
});
