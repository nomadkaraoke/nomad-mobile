import { View } from 'react-native';

import { appRoutes } from './routes';

/** App routes plus a `/make` stand-in (the real make screen lands with the make flow). */
export function signInRoutes() {
  return { ...appRoutes(), make: () => <View testID="make-stub" /> };
}
