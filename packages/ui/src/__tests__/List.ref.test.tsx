import { render } from '@testing-library/react-native';
import { createRef } from 'react';

import { List, type ListHandle } from '../List';

const mockScrollToIndex = jest.fn(() => Promise.resolve());
const mockScrollToOffset = jest.fn();

jest.mock('@shopify/flash-list', () => {
  const { forwardRef: fwd, useImperativeHandle: imp } = require('react');
  return {
    FlashList: fwd((_props: unknown, ref: unknown) => {
      imp(ref, () => ({ scrollToIndex: mockScrollToIndex, scrollToOffset: mockScrollToOffset }));
      return null;
    }),
  };
});

beforeEach(() => {
  mockScrollToIndex.mockClear();
  mockScrollToOffset.mockClear();
});

it('maps scrollToIndex(index, opts) onto FlashList params', () => {
  const ref = createRef<ListHandle>();
  render(<List ref={ref} testID="l" data={['x']} keyExtractor={(x) => x} renderItem={() => <></>} />);
  ref.current!.scrollToIndex(3, { animated: false, viewPosition: 0.5 });
  expect(mockScrollToIndex).toHaveBeenCalledWith({ index: 3, animated: false, viewPosition: 0.5 });
});

it('swallows a rejected scroll', async () => {
  mockScrollToIndex.mockReturnValueOnce(Promise.reject(new Error('no layout')));
  const ref = createRef<ListHandle>();
  render(<List ref={ref} testID="l" data={['x']} keyExtractor={(x) => x} renderItem={() => <></>} />);
  expect(() => ref.current!.scrollToIndex(0)).not.toThrow();
  await Promise.resolve();
});

it('scrollToTop scrolls to offset 0', () => {
  const ref = createRef<ListHandle>();
  render(<List ref={ref} testID="l" data={['x']} keyExtractor={(x) => x} renderItem={() => <></>} />);
  ref.current!.scrollToTop({ animated: false });
  expect(mockScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
});
