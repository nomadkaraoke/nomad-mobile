import { fireEvent, render, screen } from '@testing-library/react-native';

import { TextField } from '../TextField';

it('labels the input, reports changes, and shows errors', () => {
  const onChangeText = jest.fn();
  render(<TextField testID="f" label="Email" value="" onChangeText={onChangeText} error="Bad email" />);
  fireEvent.changeText(screen.getByLabelText('Email'), 'a@b.co');
  expect(onChangeText).toHaveBeenCalledWith('a@b.co');
  expect(screen.getByTestId('f')).toBeTruthy();
  expect(screen.getByText('Bad email')).toBeTruthy();
});
