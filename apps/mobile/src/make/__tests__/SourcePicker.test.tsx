import type { AudioResult } from '@nomad/api-gen';
import { getSearchConfidence } from '@nomad/core';
import { IntlProvider } from '@nomad/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { bestChoice, spotify, youtube } from '../../test-utils/makeFixtures';
import { PickCard, SourceGroups } from '../SourcePicker';

const wrap = (ui: ReactNode) => render(<IntlProvider locale="en">{ui}</IntlProvider>);

const studio = (index: number, over: Partial<AudioResult> = {}): AudioResult =>
  ({ ...bestChoice(index), is_lossless: true, seeders: 20, ...over }) as AudioResult;

/** Each row's index, top to bottom. */
const order = () =>
  screen
    .getAllByTestId(/^make-source-\d+$/)
    .map((el) => Number(String(el.props.testID).replace('make-source-', '')));

const groups = (results: AudioResult[], extra: Partial<Parameters<typeof SourceGroups>[0]> = {}) =>
  wrap(<SourceGroups results={results} searchTitle="Starlight" selectedIndex={null} onSelect={() => {}} {...extra} />);

it('a Spotify row shows the track (target_file), not the album', () => {
  groups([spotify(4, 'Starlight')]);
  expect(screen.getByTestId('source-title-4')).toHaveTextContent('Starlight');
  expect(screen.queryByText('Black Holes and Revelations')).toBeNull();
  expect(screen.getByTestId('make-source-4')).toHaveTextContent(/Muse\u2069 · \u2068Black Holes and Revelations/);
});

it('rows show the raw filename in monospace and the release details', () => {
  groups([studio(1, { label: 'Warner', edition_info: 'Deluxe' })]);
  const name = screen.getByTestId('source-filename-1');
  // Bidi-isolated, so an RTL sentence can't reorder the parts of a Latin file name.
  expect(name).toHaveTextContent('\u206803 - Starlight.flac\u2069', { normalizer: (t: string) => t });
  expect(name).toHaveStyle({ fontFamily: 'Menlo' });
  expect(screen.getByText('[Album / 2006 / Warner / Deluxe / CD]')).toBeTruthy();
  expect(screen.getByText('FLAC 16bit CD')).toBeTruthy();
});

it('a mixed category lists matching files first with "Title match", the wrong track last with "Wrong track?"', () => {
  groups([studio(0, { target_file: '01 - Take a Bow.flac' }), studio(1), studio(2, { target_file: 'Starlight (Live).flac' })]);
  expect(order()).toEqual([1, 2, 0]);
  expect(screen.getByTestId('source-title-match-1')).toHaveTextContent('Title match');
  expect(screen.getByTestId('source-title-match-2')).toBeTruthy();
  expect(screen.getByTestId('source-wrong-track-0')).toHaveTextContent('Wrong track?');
});

it('when every file matches there is no "Title match" noise (tiers 1–2), but tier 3 shows it', () => {
  const { unmount } = groups([studio(1), studio(2)]);
  expect(screen.queryByTestId('source-title-match-1')).toBeNull();
  unmount();
  groups([studio(1), studio(2)], { expandAll: true });
  expect(screen.getByTestId('source-title-match-1')).toBeTruthy();
});

it.each([
  [50, 'High availability'],
  [49, 'Medium availability'],
  [10, 'Medium availability'],
  [9, 'Low availability'],
])('availability badge for %i seeders: %s', (seeders, label) => {
  groups([studio(1, { seeders })]);
  expect(screen.getByTestId('source-availability-1')).toHaveTextContent(label);
});

it('no seeder count (YouTube) → no availability badge', () => {
  groups([youtube(3)]);
  expect(screen.queryByTestId('source-availability-3')).toBeNull();
});

it('a category over its cap shows "+N more", which opens and closes the rest', () => {
  // gen caps SINGLES at 2.
  const singles = [0, 1, 2, 3].map((i) => studio(i, { release_type: 'Single' }));
  groups(singles);
  expect(order()).toEqual([0, 1]);
  fireEvent.press(screen.getByTestId('make-category-more-singles'));
  expect(order()).toEqual([0, 1, 2, 3]);
  expect(screen.getByTestId('make-category-more-singles')).toHaveTextContent('Show less');
  fireEvent.press(screen.getByTestId('make-category-more-singles'));
  expect(order()).toEqual([0, 1]);
  expect(screen.getByTestId('make-category-more-singles')).toHaveTextContent('+2 more');
});

it('tier 3 opens every category: no "+N more"', () => {
  groups([0, 1, 2, 3].map((i) => studio(i, { release_type: 'Single' })), { expandAll: true });
  expect(order()).toEqual([0, 1, 2, 3]);
  expect(screen.queryByTestId('make-category-more-singles')).toBeNull();
});

it('a row reports its index when chosen', () => {
  const onSelect = jest.fn();
  groups([studio(7)], { onSelect });
  fireEvent.press(screen.getByTestId('make-source-7'));
  expect(onSelect).toHaveBeenCalledWith(7);
});

describe('pick card', () => {
  const card = (results: AudioResult[], best: AudioResult) =>
    wrap(
      <PickCard
        result={best}
        tier={1}
        confidence={getSearchConfidence(results, 'Starlight', 'Muse')}
        songTitle="Starlight"
        selected
        onPress={() => {}}
      />,
    );

  it('shows the filename, release, quality, availability and release details', () => {
    card([bestChoice(0)], bestChoice(0));
    const pick = within(screen.getByTestId('make-pick'));
    expect(screen.getByTestId('source-filename-0')).toHaveTextContent(/03 - Starlight\.flac/);
    expect(pick.getByText('\u2068Muse - Black Holes and Revelations\u2069')).toBeTruthy();
    expect(screen.getByTestId('source-availability-0')).toHaveTextContent('High availability');
    expect(pick.getByText('[Album / 2006 / CD]')).toBeTruthy();
    expect(screen.queryByTestId('make-pick-warning-0')).toBeNull();
    // A matching pick doesn't need a "Title match" badge.
    expect(screen.queryByTestId('source-title-match-0')).toBeNull();
  });

  it("shows gen's warnings and the Wrong track? badge on a doubtful pick", () => {
    const doubtful = studio(0, { seeders: 4, target_file: '01 - Take a Bow.flac' });
    card([doubtful], doubtful);
    expect(screen.getByTestId('source-wrong-track-0')).toBeTruthy();
    expect(screen.getByTestId('make-pick-warning-0')).toHaveTextContent(
      '⚠ The filename suggests a different track: \u2068Take a Bow\u2069',
    );
    expect(screen.getByTestId('make-pick-warning-1')).toHaveTextContent(/Low availability/);
  });
});
