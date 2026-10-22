import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Chip, ChipRow } from '../Chip';

it('exposes accessibilityState.selected and fires onPress', () => {
  const onPress = jest.fn();
  const { rerender } = render(<Chip testID="c" label="Any" selected={false} onPress={onPress} />);
  expect(screen.getByTestId('c').props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
  fireEvent.press(screen.getByTestId('c'));
  expect(onPress).toHaveBeenCalledTimes(1);
  rerender(<Chip testID="c" label="Any" selected onPress={onPress} accessibilityHint="hint" />);
  expect(screen.getByTestId('c').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  expect(screen.getByTestId('c').props.accessibilityHint).toBe('hint');
  expect(screen.getByText('Any')).toBeTruthy();
});

it('ChipRow renders its children in a horizontal scroller', () => {
  render(
    <ChipRow testID="row">
      <Text>child</Text>
    </ChipRow>,
  );
  expect(screen.getByTestId('row').props.horizontal).toBe(true);
  expect(screen.getByText('child')).toBeTruthy();
});
