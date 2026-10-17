import { View } from 'react-native';

import { appRoutes } from './routes';

/** App routes with the make flow stubbed: sign-in tests only check that they land on `/make/new`. */
export function signInRoutes() {
  return { ...appRoutes(), 'make/new': () => <View testID="make-stub" /> };
}
