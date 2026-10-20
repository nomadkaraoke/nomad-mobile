import { fireEvent, render, screen } from '@testing-library/react-native';
import { Modal, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

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

it('passes onDismiss to the Modal (iOS fires it once the sheet has closed)', () => {
  const onDismiss = jest.fn();
  render(
    <Sheet visible onClose={jest.fn()} onDismiss={onDismiss} title="Edit" testID="s" closeLabel="Close">
      <Text>body</Text>
    </Sheet>,
  );
  expect(screen.UNSAFE_getByType(Modal).props.onDismiss).toBe(onDismiss);
});

it('gives the modal content its own GestureHandlerRootView (gestures inside a Modal need one)', () => {
  render(
    <Sheet visible onClose={jest.fn()} title="Edit" testID="s" closeLabel="Close">
      <Text>body</Text>
    </Sheet>,
  );
  const root = screen.UNSAFE_getByType(GestureHandlerRootView);
  expect(root.props.style).toEqual({ flex: 1 });
  expect(screen.getByTestId('s-panel')).toBeTruthy();
  expect(screen.getByTestId('s-gesture-root')).toBeTruthy();
});
