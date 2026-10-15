import { render, screen } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { Text } from 'react-native';

import { IntlProvider, useTranslations } from '../index';

function Probe({ k }: { k: string }) {
  const t = useTranslations();
  return <Text>{t(k as never)}</Text>;
}

function PluralProbe({ count }: { count: number }) {
  const t = useTranslations('find');
  return <Text>{t('karaokeVersions', { count })}</Text>;
}

it('renders the locale string', () => {
  render(
    <IntlProvider locale="es">
      <Probe k="tabs.find" />
    </IntlProvider>,
  );
  const es = JSON.parse(fs.readFileSync(path.join(__dirname, '../../messages/es.json'), 'utf8'));
  expect(screen.getByText(es.tabs.find)).toBeTruthy();
});

it('formats ICU plurals', () => {
  render(
    <IntlProvider locale="en">
      <PluralProbe count={3} />
    </IntlProvider>,
  );
  expect(screen.getByText('3 karaoke versions')).toBeTruthy();
});
