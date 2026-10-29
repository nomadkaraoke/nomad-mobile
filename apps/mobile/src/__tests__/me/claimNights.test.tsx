// Phase 4c F3: the Me "Were these you?" section, its night cards, and /me/past-nights.
import * as kjbox from '@nomad/api-kjbox';
import { IntlProvider, isolate } from '@nomad/i18n';
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import type { ComponentProps, ReactNode } from 'react';

import { ClaimNightsSection } from '../../me/ClaimNightsSection';
import { CLAIM_RESULT_MS } from '../../me/useClaimNightsView';
import { useClaimAnswered } from '../../me/useClaimSuggestions';
import { appRoutes } from '../../test-utils/routes';
import { resetMe, wrapperFor } from './helpers';

jest.setTimeout(20_000);

jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getHistorySuggestions: jest.fn(),
  claimHistory: jest.fn(),
}));

let mockConnected = true;
jest.mock('@react-native-community/netinfo', () => {
  const actual = jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js');
  return { ...actual, useNetInfo: () => ({ isConnected: mockConnected, isInternetReachable: mockConnected }) };
});

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');

const song = (id: number, title: string, o: Partial<kjbox.HistorySong> = {}): kjbox.HistorySong => ({
  entry_id: id,
  singer_name: 'Wren B',
  members: ['Wren B'],
  artist: 'Muse',
  title,
  started_at: '2026-10-10T02:14:00Z',
  state: 'sung',
  ...o,
});
const night = (id: string, date: string, o: Partial<kjbox.HistoryNight> = {}): kjbox.HistoryNight => ({
  night_id: id,
  date,
  venue: 'Quill Tavern',
  names: ['Wren B'],
  unmatched: 0,
  songs: [song(11, 'Starlight'), song(12, 'Uprising'), song(13, 'Hello', { artist: 'Adele' })],
  ...o,
});
const suggestions = (nights: kjbox.HistoryNight[], more = 0): kjbox.HistorySuggestions => ({ api_version: '1.0', nights, more_nights: more });
const result = (o: Partial<kjbox.HistoryClaimResult> = {}): kjbox.HistoryClaimResult => ({
  api_version: '1.0', saved: 3, already_saved: 0, taken: [], rejected: 0, ...o,
});

type Locale = ComponentProps<typeof IntlProvider>['locale'];
const wrapper = (client: QueryClient, locale: Locale = 'en') => {
  const Q = wrapperFor(client);
  return function W({ children }: { children: ReactNode }) {
    return (
      <IntlProvider locale={locale}>
        <Q>{children}</Q>
      </IntlProvider>
    );
  };
};
const renderSection = (locale: Locale = 'en') => {
  const client = resetMe('wren@example.com');
  return render(<ClaimNightsSection />, { wrapper: wrapper(client, locale) });
};

beforeEach(() => {
  jest.useRealTimers();
  mockConnected = true;
  api.getHistorySuggestions.mockReset();
  api.claimHistory.mockReset();
  useClaimAnswered.getState().clear();
});

describe('Were these you? (Me section)', () => {
  it('renders nothing with no suggestions, or when the box is unreachable', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([]));
    const a = renderSection();
    await waitFor(() => expect(api.getHistorySuggestions).toHaveBeenCalled());
    await act(async () => {});
    expect(a.toJSON()).toBeNull();
    a.unmount();
    api.getHistorySuggestions.mockRejectedValue(new KjboxError('internal', 530, undefined, {}, true));
    const b = renderSection();
    await waitFor(() => expect(api.getHistorySuggestions).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(b.toJSON()).toBeNull();
  });

  it('a card: date, song count as the name, venue, songs all ticked, unmatched line', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10', { unmatched: 2 })]));
    renderSection();
    const card = await screen.findByTestId('me-claim-night-0');
    expect(screen.getByText('Were these you?')).toBeTruthy();
    expect(within(card).getByTestId('me-claim-header-0')).toHaveTextContent(`Sat, Oct 10 · 3 songs as “${isolate('Wren B')}”`);
    expect(within(card).getByText(isolate('Quill Tavern'))).toBeTruthy();
    for (const j of [0, 1, 2]) {
      const row = within(card).getByTestId(`me-claim-song-0-${j}`);
      expect(row.props.accessibilityRole).toBe('checkbox');
      expect(row.props.accessibilityState).toMatchObject({ checked: true });
    }
    expect(within(card).getByTestId('me-claim-song-0-2')).toHaveTextContent(new RegExp(`${isolate('Hello')} · ${isolate('Adele')}$`));
    expect(within(card).getByTestId('me-claim-unmatched-0')).toHaveTextContent("2 more songs couldn't be matched");
  });

  it('no unmatched line when every song matched', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10')]));
    renderSection();
    await screen.findByTestId('me-claim-night-0');
    expect(screen.queryByTestId('me-claim-unmatched-0')).toBeNull();
  });

  it('unticking one sends it as not_mine, then shows the saved line for 5 s and the card goes', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10')]));
    api.claimHistory.mockResolvedValue(result({ saved: 2, rejected: 1 }));
    renderSection();
    await screen.findByTestId('me-claim-night-0');
    jest.useFakeTimers();
    fireEvent.press(screen.getByTestId('me-claim-song-0-1'));
    expect(screen.getByTestId('me-claim-song-0-1').props.accessibilityState).toMatchObject({ checked: false });
    await act(async () => {
      fireEvent.press(screen.getByTestId('me-claim-save-0'));
    });
    expect(api.claimHistory).toHaveBeenCalledWith('n1', [11, 13], [12]);
    expect(await screen.findByTestId('me-claim-result-0')).toHaveTextContent("Saved 2 songs. They'll show in your history in a minute.");
    expect(screen.queryByTestId('me-claim-save-0')).toBeNull();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(CLAIM_RESULT_MS);
    });
    expect(screen.queryByTestId('me-claim-night-0')).toBeNull();
  });

  it('None of these are me sends every song as not_mine and the night leaves', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10'), night('n2', '2026-10-03')]));
    api.claimHistory.mockResolvedValue(result({ saved: 0, rejected: 3 }));
    renderSection();
    await screen.findByTestId('me-claim-night-1');
    await act(async () => {
      fireEvent.press(screen.getByTestId('me-claim-none-0'));
    });
    expect(api.claimHistory).toHaveBeenCalledWith('n1', [], [11, 12, 13]);
    await waitFor(() => expect(screen.queryByTestId('me-claim-night-1')).toBeNull());
    expect(screen.getByTestId('me-claim-header-0')).toHaveTextContent(/Oct 3/);
  });

  it('Save is disabled with nothing ticked', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10')]));
    renderSection();
    await screen.findByTestId('me-claim-night-0');
    for (const j of [0, 1, 2]) fireEvent.press(screen.getByTestId(`me-claim-song-0-${j}`));
    expect(screen.getByTestId('me-claim-save-0').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId('me-claim-save-0'));
    expect(api.claimHistory).not.toHaveBeenCalled();
  });

  it('Save and None are disabled offline', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10')]));
    const client = resetMe('wren@example.com');
    const { ClaimNightCard } = jest.requireActual<typeof import('../../me/ClaimNightCard')>('../../me/ClaimNightCard');
    render(
      <ClaimNightCard
        prefix="me-claim"
        index={0}
        night={night('n1', '2026-10-10')}
        unticked={new Set()}
        status="idle"
        offline
        onToggle={jest.fn()}
        onSave={jest.fn()}
        onNone={jest.fn()}
      />,
      { wrapper: wrapper(client) },
    );
    expect(screen.getByTestId('me-claim-save-0').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('me-claim-none-0').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('a failed Save keeps the card, the ticks and shows the error line', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10')]));
    api.claimHistory.mockRejectedValue(new KjboxError('invalid', 400));
    renderSection();
    await screen.findByTestId('me-claim-night-0');
    fireEvent.press(screen.getByTestId('me-claim-song-0-0'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('me-claim-save-0'));
    });
    expect(await screen.findByTestId('me-claim-error-0')).toHaveTextContent("Couldn't reach the host's machine. Try again later.");
    expect(screen.getByTestId('me-claim-song-0-0').props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByTestId('me-claim-song-0-1').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('me-claim-save-0')).toBeTruthy();
  });

  it('the taken line when someone else already saved a song', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10')]));
    api.claimHistory.mockResolvedValue(result({ saved: 2, taken: [12] }));
    renderSection();
    await screen.findByTestId('me-claim-night-0');
    await act(async () => {
      fireEvent.press(screen.getByTestId('me-claim-save-0'));
    });
    expect(await screen.findByTestId('me-claim-taken-0')).toHaveTextContent('1 was already saved by someone else.');
  });

  it('a double tap on Save sends one claim', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10')]));
    let resolve!: (r: kjbox.HistoryClaimResult) => void;
    api.claimHistory.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderSection();
    await screen.findByTestId('me-claim-night-0');
    fireEvent.press(screen.getByTestId('me-claim-save-0'));
    fireEvent.press(screen.getByTestId('me-claim-save-0'));
    await act(async () => resolve(result()));
    expect(api.claimHistory).toHaveBeenCalledTimes(1);
  });

  it('shows at most 2 nights, and See all 3 nights at 3 nights', async () => {
    api.getHistorySuggestions.mockResolvedValue(
      suggestions([night('n1', '2026-10-10'), night('n2', '2026-10-03'), night('n3', '2026-09-26')]),
    );
    renderSection();
    await screen.findByTestId('me-claim-night-1');
    expect(screen.queryByTestId('me-claim-night-2')).toBeNull();
    expect(screen.getByTestId('me-claim-all')).toHaveTextContent('See all 3 nights');
  });

  it('no See all at 2 nights; See all counts more_nights', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10'), night('n2', '2026-10-03')]));
    const a = renderSection();
    await screen.findByTestId('me-claim-night-1');
    expect(screen.queryByTestId('me-claim-all')).toBeNull();
    a.unmount();
    useClaimAnswered.getState().clear();
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10')], 4));
    renderSection();
    expect(await screen.findByTestId('me-claim-all')).toHaveTextContent('See all 5 nights');
  });

  it('RTL (ar): the name and the titles are isolated', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1', '2026-10-10')]));
    renderSection('ar');
    const header = await screen.findByTestId('me-claim-header-0');
    expect(JSON.stringify(header.props.children ?? '')).toContain(isolate('Wren B'));
    expect(screen.getByTestId('me-claim-song-0-0')).toHaveTextContent(new RegExp(isolate('Starlight')));
  });
});

describe('/me/past-nights', () => {
  beforeEach(() => {
    resetMe('wren@example.com');
  });

  it('lists every night, with the "most recent" line when there are more', async () => {
    api.getHistorySuggestions.mockResolvedValue(
      suggestions([night('n1', '2026-10-10'), night('n2', '2026-10-03'), night('n3', '2026-09-26')], 7),
    );
    renderRouter(appRoutes(), { initialUrl: '/me/past-nights' });
    expect(await screen.findByTestId('me-past-nights')).toBeTruthy();
    expect(await screen.findByTestId('me-past-night-2')).toBeTruthy();
    expect(screen.getByTestId('me-past-nights-recent')).toHaveTextContent('Showing your 3 most recent nights');
  });

  it('See all opens it from Me', async () => {
    api.getHistorySuggestions.mockResolvedValue(
      suggestions([night('n1', '2026-10-10'), night('n2', '2026-10-03'), night('n3', '2026-09-26')]),
    );
    renderRouter(appRoutes(), { initialUrl: '/me' });
    fireEvent.press(await screen.findByTestId('me-claim-all'));
    expect(await screen.findByTestId('me-past-night-2')).toBeTruthy();
    expect(screen.queryByTestId('me-past-nights-recent')).toBeNull();
  });
});
