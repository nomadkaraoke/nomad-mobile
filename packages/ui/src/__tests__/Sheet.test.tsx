import { fireEvent, render, screen } from '@testing-library/react-native';
import { Modal, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Sheet, SHEET_BOTTOM_PADDING } from '../Sheet';

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
  expect(screen.getByTestId('s-backdrop').props.accessibilityLabel).toBe('Close');
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

it('has a labelled 44 pt close button in its header (the backdrop is a thin strip once the keyboard is up)', () => {
  const onClose = jest.fn();
  render(
    <Sheet visible onClose={onClose} title="Edit" testID="s" closeLabel="Close">
      <Text>body</Text>
    </Sheet>,
  );
  const close = screen.getByTestId('s-close');
  expect(close.props.accessibilityLabel).toBe('Close');
  expect(close.props.accessibilityRole).toBe('button');
  expect(close.props.className).toEqual(expect.stringContaining('h-11'));
  fireEvent.press(close);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('pads the panel by the bottom safe-area inset so content clears the gesture/nav bar', () => {
  const metrics = { frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <Sheet visible onClose={jest.fn()} title="Edit" testID="s" closeLabel="Close">
        <Text>body</Text>
      </Sheet>
    </SafeAreaProvider>,
  );
  expect(screen.getByTestId('s-panel')).toHaveStyle({ paddingBottom: SHEET_BOTTOM_PADDING + 34 });
});

it('outside a SafeAreaProvider the panel keeps its own padding (no throw)', () => {
  render(
    <Sheet visible onClose={jest.fn()} title="Edit" testID="s" closeLabel="Close">
      <Text>body</Text>
    </Sheet>,
  );
  expect(screen.getByTestId('s-panel')).toHaveStyle({ paddingBottom: SHEET_BOTTOM_PADDING });
});
