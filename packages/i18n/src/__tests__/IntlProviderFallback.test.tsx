import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { IntlProvider, useTranslations } from '../index';

// fr.json is missing tabs.find (and everything else) for this whole file.
jest.mock('../../messages/fr.json', () => ({ tabs: {} }));

function Probe() {
  const t = useTranslations('tabs');
  return <Text>{t('find')}</Text>;
}

it('falls back to the en string (not the key path) for a key missing in the locale', () => {
  render(
    <IntlProvider locale="fr">
      <Probe />
    </IntlProvider>,
  );
  expect(screen.getByText('Find')).toBeTruthy();
  expect(screen.queryByText('tabs.find')).toBeNull();
});
