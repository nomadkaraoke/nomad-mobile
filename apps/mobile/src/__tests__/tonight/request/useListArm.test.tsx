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

  it('the list changing again pushes the queued tap to the end of the new window; a later tap replaces it', () => {
    const { result } = renderHook(() => useListArm());
    const first = jest.fn();
    const second = jest.fn();
    act(() => result.current.arm());
    act(() => result.current.guard(first)());
    act(() => jest.advanceTimersByTime(200));
    act(() => result.current.arm());
    act(() => jest.advanceTimersByTime(200));
    expect(first).not.toHaveBeenCalled();
    act(() => result.current.guard(second)());
    act(() => jest.advanceTimersByTime(LIST_ARM_MS));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
