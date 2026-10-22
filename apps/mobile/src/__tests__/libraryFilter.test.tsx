import { IntlProvider } from '@nomad/i18n';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { LibraryBadge, LibraryFilterPicker, useLibraryFilter } from '../find/library';
import { appStorage } from '../storage';

const wrap = (ui: ReactNode) => render(<IntlProvider locale="en">{ui}</IntlProvider>);

// The store reads MMKV once at import: a fresh copy of the module simulates an app relaunch.
const relaunch = () => {
  let mod!: typeof import('../find/library/store');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../find/library/store');
  });
  return mod.useLibraryFilter;
};

beforeEach(() => {
  appStorage.remove('discover.library.v1');
  act(() => useLibraryFilter.setState({ filter: 'any' }));
});

it('tapping KaraFun selects and persists it; a relaunch reads it back', () => {
  wrap(<LibraryFilterPicker />);
  expect(screen.getByTestId('library-filter-any').props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByTestId('library-filter-karafun'));
  expect(screen.getByTestId('library-filter-karafun').props.accessibilityState.selected).toBe(true);
  expect(appStorage.getString('discover.library.v1')).toBe('karafun');
  expect(relaunch().getState().filter).toBe('karafun');
});

it('is a radiogroup of radios', () => {
  wrap(<LibraryFilterPicker />);
  expect(screen.getByTestId('library-filter').props.accessibilityRole).toBe('radiogroup');
  expect(screen.getByTestId('library-filter').props.accessibilityLabel).toBe('Venue library');
  expect(screen.getByTestId('library-filter-any').props.accessibilityRole).toBe('radio');
  expect(screen.getByTestId('library-filter-any').props.accessibilityState).toEqual({ selected: true, checked: true });
});

it('shows the KaraFun catalogue info line only while KaraFun is chosen', () => {
  wrap(<LibraryFilterPicker />);
  expect(screen.queryByTestId('library-filter-info')).toBeNull();
  fireEvent.press(screen.getByTestId('library-filter-karafun'));
  expect(screen.getByText('KaraFun / Karaoke Version catalogue')).toBeTruthy();
  fireEvent.press(screen.getByTestId('library-filter-community'));
  expect(screen.queryByTestId('library-filter-info')).toBeNull();
});

it('a garbage stored value falls back to any and is removed', () => {
  appStorage.set('discover.library.v1', 'bogus');
  expect(relaunch().getState().filter).toBe('any');
  expect(appStorage.getString('discover.library.v1')).toBeUndefined();
});

it('badge shows a pill per library the song is in, and nothing for an untagged song', () => {
  const { rerender } = wrap(
    <LibraryBadge
      song={{ versions: [{ kind: 'commercial', brand_code: 'KV' }, { kind: 'community' }] }}
    />,
  );
  expect(screen.getByTestId('library-badge-community')).toBeTruthy();
  expect(screen.getByTestId('library-badge-karafun')).toBeTruthy();
  expect(screen.getByText('Community')).toBeTruthy();
  expect(screen.getByText('KaraFun')).toBeTruthy();
  rerender(
    <IntlProvider locale="en">
      <LibraryBadge song={{}} />
    </IntlProvider>,
  );
  expect(screen.queryByTestId('library-badge-community')).toBeNull();
  expect(screen.queryByTestId('library-badge-karafun')).toBeNull();
});
