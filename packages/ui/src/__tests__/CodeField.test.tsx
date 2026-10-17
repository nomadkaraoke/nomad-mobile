import { fireEvent, render, screen } from '@testing-library/react-native';

import { CodeField } from '../CodeField';

it('shows one box per digit and keeps only digits, up to the length', () => {
  const onChangeText = jest.fn();
  const { rerender } = render(<CodeField testID="c" label="Code" value="" onChangeText={onChangeText} />);
  fireEvent.changeText(screen.getByLabelText('Code'), '12 3-45678');
  expect(onChangeText).toHaveBeenCalledWith('123456');

  rerender(<CodeField testID="c" label="Code" value="123" onChangeText={onChangeText} />);
  expect(screen.getByTestId('c-box-0')).toHaveTextContent('1');
  expect(screen.getByTestId('c-box-2')).toHaveTextContent('3');
  expect(screen.getByTestId('c-box-3')).toHaveTextContent('');
  expect(screen.queryByTestId('c-box-6')).toBeNull();
});

it('calls onFilled once all digits are in', () => {
  const onFilled = jest.fn();
  render(<CodeField testID="c" label="Code" value="" onChangeText={() => {}} onFilled={onFilled} />);
  fireEvent.changeText(screen.getByTestId('c'), '12345');
  expect(onFilled).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByTestId('c'), '123456');
  expect(onFilled).toHaveBeenCalledWith('123456');
});
