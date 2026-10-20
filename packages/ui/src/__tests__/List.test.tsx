import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { createRef } from 'react';

import { List, type ListHandle } from '../List';

it('renders items and the empty component', () => {
  const { rerender } = render(
    <List testID="l" data={['a', 'b']} keyExtractor={(x) => x} renderItem={(x) => <Text>{x}</Text>} />,
  );
  expect(screen.getByText('a')).toBeTruthy();
  expect(screen.getByText('b')).toBeTruthy();
  rerender(
    <List
      testID="l"
      data={[] as string[]}
      keyExtractor={(x) => x}
      renderItem={(x) => <Text>{x}</Text>}
      ListEmptyComponent={<Text>empty</Text>}
    />,
  );
  expect(screen.getByText('empty')).toBeTruthy();
});

it('passes the item index to renderItem', () => {
  render(<List testID="l" data={['x', 'y']} keyExtractor={(x) => x} renderItem={(x, i) => <Text>{`${i}:${x}`}</Text>} />);
  expect(screen.getByText('1:y')).toBeTruthy();
});

it('exposes scrollToIndex through the ref', () => {
  const ref = createRef<ListHandle>();
  render(<List ref={ref} testID="l" data={['x', 'y']} keyExtractor={(x) => x} renderItem={(x) => <Text>{x}</Text>} />);
  expect(() => ref.current!.scrollToIndex(1, { animated: false, viewPosition: 0.5 })).not.toThrow();
});

it('forwards extraData, getItemType and onScrollBeginDrag', () => {
  const onScrollBeginDrag = jest.fn();
  const getItemType = jest.fn(() => 'row');
  render(
    <List
      testID="l"
      data={['x']}
      extraData={1}
      getItemType={getItemType}
      onScrollBeginDrag={onScrollBeginDrag}
      keyExtractor={(x) => x}
      renderItem={(x) => <Text>{x}</Text>}
    />,
  );
  expect(getItemType).toHaveBeenCalled();
  fireEvent(screen.getByTestId('l'), 'scrollBeginDrag');
  expect(onScrollBeginDrag).toHaveBeenCalled();
});
