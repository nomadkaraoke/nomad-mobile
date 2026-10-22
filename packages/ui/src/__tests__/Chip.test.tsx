import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Chip, ChipRow } from '../Chip';

it('exposes accessibilityState.selected and fires onPress', () => {
  const onPress = jest.fn();
  const { rerender } = render(<Chip testID="c" label="Any" selected={false} onPress={onPress} />);
  expect(screen.getByTestId('c').props.accessibilityState).toEqual({ selected: false });
  fireEvent.press(screen.getByTestId('c'));
  expect(onPress).toHaveBeenCalledTimes(1);
  rerender(<Chip testID="c" label="Any" selected onPress={onPress} accessibilityHint="hint" />);
  expect(screen.getByTestId('c').props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByTestId('c').props.accessibilityHint).toBe('hint');
  expect(screen.getByText('Any')).toBeTruthy();
});

it('role radio reports checked as well as selected', () => {
  render(<Chip testID="r" label="A" role="radio" selected onPress={jest.fn()} />);
  expect(screen.getByTestId('r').props.accessibilityRole).toBe('radio');
  expect(screen.getByTestId('r').props.accessibilityState).toEqual({ selected: true, checked: true });
});

it('ChipRow renders its children in a horizontal scroller', () => {
  render(
    <ChipRow testID="row">
      <Text>child</Text>
    </ChipRow>,
  );
  expect(screen.getByTestId('row').props.horizontal).toBe(true);
  // Never grows along a flex column's main axis (it stretched the chips tall above the picks list).
  expect(screen.getByTestId('row').props.style).toEqual(expect.objectContaining({ flexGrow: 0 }));
  expect(screen.getByText('child')).toBeTruthy();
});

it('a chip row takes the tap while the keyboard is up (the first tap picks the chip instead of only closing it)', () => {
  render(
    <ChipRow testID="row">
      <Text>x</Text>
    </ChipRow>,
  );
  expect(screen.getByTestId('row').props.keyboardShouldPersistTaps).toBe('handled');
});
