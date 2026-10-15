import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { List } from '../List';

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
