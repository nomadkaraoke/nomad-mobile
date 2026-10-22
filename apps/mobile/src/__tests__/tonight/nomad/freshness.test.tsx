import { act, fireEvent, screen } from '@testing-library/react-native';

import { Freshness, FRESHNESS_TICK_MS } from '../../../tonight/nomad/Freshness';
import { renderTonight } from '../../../test-utils/tonightFixtures';

afterEach(() => jest.useRealTimers());

it('the age label ticks every 5 s (never a frozen "just now")', () => {
  jest.useFakeTimers({ now: 1_000_000 });
  const onRefresh = jest.fn();
  renderTonight(<Freshness updatedAt={1_000_000 - 3_000} onRefresh={onRefresh} />);
  expect(screen.getByTestId('tonight-freshness')).toHaveTextContent('Updated just now');
  act(() => jest.advanceTimersByTime(FRESHNESS_TICK_MS * 2));
  expect(screen.getByTestId('tonight-freshness')).toHaveTextContent('Updated 13s ago');
  act(() => jest.advanceTimersByTime(60_000));
  expect(screen.getByTestId('tonight-freshness')).toHaveTextContent('Updated 1 min ago');
  fireEvent.press(screen.getByTestId('tonight-refresh'));
  expect(onRefresh).toHaveBeenCalled();
});
