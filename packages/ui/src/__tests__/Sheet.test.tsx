import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Sheet } from '../Sheet';

it('renders title and children when visible', () => {
  render(
    <Sheet visible onClose={jest.fn()} title="Edit" testID="s" closeLabel="Close">
      <Text>body</Text>
    </Sheet>,
  );
  expect(screen.getByText('Edit')).toBeTruthy();
  expect(screen.getByText('body')).toBeTruthy();
});

it('renders nothing when hidden', () => {
  render(
    <Sheet visible={false} onClose={jest.fn()} title="Edit" testID="s" closeLabel="Close">
      <Text>body</Text>
    </Sheet>,
  );
  expect(screen.queryByText('body')).toBeNull();
});

it('closes on backdrop press and labels the backdrop', () => {
  const onClose = jest.fn();
  render(
    <Sheet visible onClose={onClose} title="Edit" testID="s" closeLabel="Close">
      <Text>body</Text>
    </Sheet>,
  );
  expect(screen.getByLabelText('Close')).toBeTruthy();
  fireEvent.press(screen.getByTestId('s-backdrop'));
  expect(onClose).toHaveBeenCalledTimes(1);
});
