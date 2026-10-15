import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from '../Button';

it('fires onPress, but not when disabled or loading', () => {
  const onPress = jest.fn();
  const { rerender } = render(<Button testID="b" label="Go" onPress={onPress} />);
  fireEvent.press(screen.getByTestId('b'));
  expect(onPress).toHaveBeenCalledTimes(1);
  rerender(<Button testID="b" label="Go" onPress={onPress} disabled />);
  fireEvent.press(screen.getByTestId('b'));
  rerender(<Button testID="b" label="Go" onPress={onPress} loading />);
  fireEvent.press(screen.getByTestId('b'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('shows the label, and a spinner instead while loading', () => {
  const { rerender } = render(<Button testID="b" label="Go" onPress={jest.fn()} />);
  expect(screen.getByText('Go')).toBeTruthy();
  rerender(<Button testID="b" label="Go" onPress={jest.fn()} loading />);
  expect(screen.queryByText('Go')).toBeNull();
  expect(screen.getByTestId('b-spinner')).toBeTruthy();
});
