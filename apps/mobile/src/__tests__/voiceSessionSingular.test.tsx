import { act, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { voiceSessionScreenProps } from '../voiceSession/screenProps';

beforeEach(() => jest.useRealTimers());

it('marks the session modal singular', () => {
  expect(voiceSessionScreenProps('Voice')).toMatchObject({ options: { presentation: 'modal' }, dangerouslySingular: true });
});

it('routing to the session again while it is open does not stack a second modal', async () => {
  const app = renderRouter(
    {
      _layout: () => (
        <Stack>
          <Stack.Screen name="discover/voice-session" {...voiceSessionScreenProps('Voice')} />
        </Stack>
      ),
      index: () => <View testID="home" />,
      'discover/voice-session': () => <View testID="session" />,
    },
    { initialUrl: '/' },
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- router singleton
  const { router } = require('expo-router');
  act(() => router.push('/discover/voice-session'));
  act(() => router.push('/discover/voice-session'));
  expect(await screen.findByTestId('session')).toBeTruthy();
  expect(app.getPathname()).toBe('/discover/voice-session');
  act(() => router.back());
  expect(app.getPathname()).toBe('/');
});
