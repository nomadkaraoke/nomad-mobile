import { render } from '@testing-library/react-native';

import { List } from '../List';

const mockProps = jest.fn();

jest.mock('@shopify/flash-list', () => {
  const { forwardRef: fwd } = require('react');
  return {
    FlashList: fwd((props: unknown) => {
      mockProps(props);
      return null;
    }),
  };
});

beforeEach(() => mockProps.mockClear());

const lastProps = () => mockProps.mock.calls[mockProps.mock.calls.length - 1][0];

it('keeps FlashList default (hold the visible rows) unless asked', () => {
  render(<List testID="l" data={['x']} keyExtractor={(x) => x} renderItem={() => <></>} />);
  expect(lastProps().maintainVisibleContentPosition).toBeUndefined();
});

it('showNewRowsAtTop turns off holding the visible rows, so a row added at the top shows', () => {
  render(<List testID="l" data={['x']} keyExtractor={(x) => x} renderItem={() => <></>} showNewRowsAtTop />);
  expect(lastProps().maintainVisibleContentPosition).toEqual({ disabled: true });
  expect(lastProps()).not.toHaveProperty('showNewRowsAtTop');
});
