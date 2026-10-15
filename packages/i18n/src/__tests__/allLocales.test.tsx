import { render, screen } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { Text } from 'react-native';

import { IntlProvider, LOCALES, useTranslations } from '../index';

function Probe() {
  const t = useTranslations('tabs');
  return <Text>{t('find')}</Text>;
}

// Every locale must be wired to its own JSON (catches a wrong/missing loader path).
it.each(LOCALES)('%s renders its own translation', (locale) => {
  const messages = JSON.parse(fs.readFileSync(path.join(__dirname, `../../messages/${locale}.json`), 'utf8'));
  render(
    <IntlProvider locale={locale}>
      <Probe />
    </IntlProvider>,
  );
  expect(screen.getByText(messages.tabs.find)).toBeTruthy();
});
