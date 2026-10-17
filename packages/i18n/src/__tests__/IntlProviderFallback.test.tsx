import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { IntlProvider, useTranslations } from '../index';

// fr.json is missing tabs.discover (and everything else) for this whole file.
jest.mock('../../messages/fr.json', () => ({ tabs: {} }));

function Probe() {
  const t = useTranslations('tabs');
  return <Text>{t('discover')}</Text>;
}

it('falls back to the en string (not the key path) for a key missing in the locale', () => {
  render(
    <IntlProvider locale="fr">
      <Probe />
    </IntlProvider>,
  );
  expect(screen.getByText('Discover')).toBeTruthy();
  expect(screen.queryByText('tabs.discover')).toBeNull();
});
