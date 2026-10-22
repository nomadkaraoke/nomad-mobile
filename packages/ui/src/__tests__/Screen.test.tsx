import { render, screen } from '@testing-library/react-native';

import { Screen } from '../Screen';
import { Text } from '../Text';

it('pads for the status bar by default, but not under a native header (no double top inset)', () => {
  const { rerender } = render(
    <Screen testID="s">
      <Text>x</Text>
    </Screen>,
  );
  expect(screen.getByTestId('s').props.edges).toMatchObject({ top: 'additive', left: 'additive', right: 'additive' });
  rerender(
    <Screen testID="s" underHeader>
      <Text>x</Text>
    </Screen>,
  );
  expect(screen.getByTestId('s').props.edges).toMatchObject({ top: 'off', left: 'additive', right: 'additive' });
});
