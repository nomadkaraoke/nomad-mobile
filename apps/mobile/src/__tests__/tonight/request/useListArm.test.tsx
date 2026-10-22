import { act, renderHook } from '@testing-library/react-native';

import { LIST_ARM_MS, useListArm } from '../../../tonight/request/useListArm';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useListArm (ruling E5-R1, A.18)', () => {
  it('tap during arm is queued and replayed at the end of the window, not dropped', () => {
    const { result } = renderHook(() => useListArm());
    const onTap = jest.fn();
    act(() => result.current.arm());
    act(() => result.current.guard(onTap)('row-2'));
    expect(onTap).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(LIST_ARM_MS));
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith('row-2');
  });

  it('a tap outside the window runs at once', () => {
    const { result } = renderHook(() => useListArm());
    const onTap = jest.fn();
    act(() => result.current.arm());
    act(() => jest.advanceTimersByTime(LIST_ARM_MS));
    act(() => result.current.guard(onTap)());
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('a list change while a tap is queued drops it (its target is gone); a later tap replaces a queued one', () => {
    const { result } = renderHook(() => useListArm());
    const first = jest.fn();
    const second = jest.fn();
    const third = jest.fn();
    act(() => result.current.arm());
    act(() => result.current.guard(first)());
    act(() => jest.advanceTimersByTime(200));
    act(() => result.current.arm());
    act(() => jest.advanceTimersByTime(LIST_ARM_MS * 2));
    expect(first).not.toHaveBeenCalled();
    act(() => result.current.arm());
    act(() => result.current.guard(second)());
    act(() => result.current.guard(third)());
    act(() => jest.advanceTimersByTime(LIST_ARM_MS));
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
  });
});
