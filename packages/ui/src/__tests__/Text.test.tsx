import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { StartText, Text } from '../Text';

const align = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style)?.textAlign;

it("aligns to the start of the line: 'left', which React Native mirrors to the right in RTL", () => {
  render(<Text>Hello</Text>);
  expect(align('Hello')).toBe('left');
});

it('leaves an explicit alignment class alone, and a caller style still wins', () => {
  render(
    <>
      <Text className="text-center">Mid</Text>
      <Text style={{ textAlign: 'right' }}>End</Text>
    </>,
  );
  expect(align('Mid')).toBeUndefined();
  expect(align('End')).toBe('right');
});

describe('StartText', () => {
  it('is start-aligned like Text, with no variant classes of its own', () => {
    render(
      <>
        <StartText className="text-xs text-muted">Plain</StartText>
        <StartText className="text-center">Centred</StartText>
      </>,
    );
    expect(align('Plain')).toBe('left');
    expect(screen.getByText('Plain').props.className).toBe('text-xs text-muted');
    expect(align('Centred')).toBeUndefined();
  });
});
