import { ApiError } from '@nomad/api-gen';
import { IntlProvider } from '@nomad/i18n';
import type { CorrectionData } from '@nomad/review-core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import ReviewRoute from '../../app/review/[id]';
import { saveDraft } from '../../review/drafts';
import { ReviewScreen } from '../../review/ReviewScreen';
import { cleanFixture, correctionsFixture, fakePlayer } from '../../test-utils/reviewFixtures';

let mockPlayer = fakePlayer();
const mockPlayerOpts = jest.fn();
jest.mock('../../review/audio/useReviewPlayer', () => ({
  useReviewPlayer: (jobId: string, opts: unknown) => {
    mockPlayerOpts(jobId, opts);
    return mockPlayer;
  },
}));

jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getVocalsPeaks: jest.fn(),
  getInstrumentalUrls: jest.fn(),
  warmupEncoder: jest.fn(async () => {}),
  encoderHeartbeat: jest.fn(async () => {}),
  reportClientEvent: jest.fn(async () => {}),
  startReview: jest.fn(),
  getCorrectionData: jest.fn(),
}));
const gen = jest.requireMock('@nomad/api-gen') as Record<string, jest.Mock>;

const STEMS = {
  instrumental_options: [
    { id: 'clean', label: 'Clean', audio_url: '/c' },
    { id: 'with_backing', label: 'With backing', audio_url: '/b' },
  ],
};

/** Renders the screen and lets the mount-time requests (peaks, warmup) settle. */
async function renderScreen(data: CorrectionData, props: { onContinueOnWeb?: () => void } = {}) {
  const r = render(
    <IntlProvider locale="en">
      <ReviewScreen jobId="j1" data={data} {...props} />
    </IntlProvider>,
  );
  await act(async () => {});
  return r;
}

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  (jest.requireMock('react-native-mmkv') as { __resetMMKV(): void }).__resetMMKV();
  mockPlayer = fakePlayer();
  gen.getVocalsPeaks!.mockResolvedValue({ status: 'ready', peaks: 'AAD/', rate: 1 });
});

describe('ReviewScreen', () => {
  it('opens on the lyrics step with the song title, warming the encoder', async () => {
    await renderScreen(correctionsFixture());
    expect(screen.getByTestId('review-screen')).toBeTruthy();
    expect(screen.getByTestId('review-step-lyrics')).toBeTruthy();
    expect(screen.queryByTestId('review-step-finish')).toBeNull();
    expect(screen.getByText('The Sound of Silence')).toBeTruthy();
    expect(gen.warmupEncoder).toHaveBeenCalledWith('j1');
    await waitFor(() => expect(gen.getVocalsPeaks).toHaveBeenCalledWith('j1'));
  });

  it('starts on Finish when the lyrics are confident', async () => {
    await renderScreen(correctionsFixture({ auto_approval: { lyrics: { confident: true } } }));
    expect(screen.getByTestId('review-step-finish')).toBeTruthy();
    expect(screen.queryByTestId('review-step-lyrics')).toBeNull();
  });

  it('"Lyrics look good" moves to Finish, and the Lyrics step header goes back', async () => {
    await renderScreen(cleanFixture());
    fireEvent.press(screen.getByTestId('review-lyrics-next'));
    expect(screen.getByTestId('review-step-finish')).toBeTruthy();
    expect(mockPlayer.pause).toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('review-steps-lyrics'));
    expect(screen.getByTestId('review-step-lyrics')).toBeTruthy();
  });

  it('vocals fall back to the song until the stems are ready', async () => {
    await renderScreen(cleanFixture());
    expect(mockPlayerOpts).toHaveBeenLastCalledWith('j1', { vocalsReady: false });
  });

  it('vocals play once both stems exist', async () => {
    await renderScreen(cleanFixture(STEMS as Partial<CorrectionData>));
    expect(mockPlayerOpts).toHaveBeenLastCalledWith('j1', { vocalsReady: true });
  });

  it('undo is disabled until there is an edit, then reverts it', async () => {
    await renderScreen(correctionsFixture());
    const undo = () => screen.getByTestId('review-undo');
    expect(undo().props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    fireEvent.press(screen.getByTestId('review-line-0'));
    fireEvent.press(screen.getByTestId('review-tool-more'));
    fireEvent.press(screen.getByTestId('review-tool-delete'));
    expect(screen.queryByText('Hello')).toBeNull();
    expect(undo().props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
    fireEvent.press(undo());
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('shows the restored-draft banner, and Discard resets to the server data', async () => {
    const data = correctionsFixture();
    const edited = data.corrected_segments.slice(1);
    saveDraft('j1', { v: 1, audioHash: 'h1', segments: edited, isDuet: false, selection: null, editCount: 1, savedAt: 1 });
    await renderScreen(data);
    expect(screen.getByText('Restored your edits')).toBeTruthy();
    expect(screen.queryByText('Hello')).toBeNull();
    fireEvent.press(screen.getByTestId('review-restored-discard'));
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.queryByTestId('review-restored-discard')).toBeNull();
  });

  it('menu: Mark as duet shows singer chips; Not a duet hides them', async () => {
    await renderScreen(correctionsFixture());
    fireEvent.press(screen.getByTestId('review-menu'));
    expect(screen.queryByTestId('review-menu-web')).toBeNull();
    expect(screen.getByTestId('review-menu-duet')).toHaveTextContent('Mark as duet');
    fireEvent.press(screen.getByTestId('review-menu-duet'));
    expect(screen.getByTestId('review-line-0-singer')).toBeTruthy();
    fireEvent.press(screen.getByTestId('review-menu'));
    expect(screen.getByTestId('review-menu-duet')).toHaveTextContent('Not a duet');
    fireEvent.press(screen.getByTestId('review-menu-duet'));
    expect(screen.queryByTestId('review-line-0-singer')).toBeNull();
  });

  it('menu: Continue on web shows when wired', async () => {
    const onContinueOnWeb = jest.fn();
    await renderScreen(correctionsFixture(), { onContinueOnWeb });
    fireEvent.press(screen.getByTestId('review-menu'));
    fireEvent.press(screen.getByTestId('review-menu-web'));
    expect(onContinueOnWeb).toHaveBeenCalled();
  });

  it('menu: Discard my edits asks first, then resets', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await renderScreen(correctionsFixture());
    fireEvent.press(screen.getByTestId('review-line-0'));
    fireEvent.press(screen.getByTestId('review-tool-more'));
    fireEvent.press(screen.getByTestId('review-tool-delete'));
    fireEvent.press(screen.getByTestId('review-menu'));
    fireEvent.press(screen.getByTestId('review-menu-discard'));
    expect(screen.queryByText('Hello')).toBeNull();
    const buttons = alert.mock.calls[0]![2]!;
    act(() => buttons.find((b) => b.style === 'destructive')!.onPress!());
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('reports waveform_failed when the vocals peaks fail', async () => {
    gen.getVocalsPeaks!.mockRejectedValue(new ApiError(500, 'boom'));
    await renderScreen(cleanFixture());
    await waitFor(() => expect(gen.reportClientEvent).toHaveBeenCalledWith('waveform_failed', expect.objectContaining({ jobId: 'j1' })));
  });

  it('polls the peaks while the stems are separating', async () => {
    jest.useFakeTimers();
    gen.getVocalsPeaks!.mockResolvedValueOnce({ status: 'pending', retryAfter: 5 });
    await renderScreen(cleanFixture());
    expect(screen.getByText('Loading the vocals…')).toBeTruthy();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(gen.getVocalsPeaks).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Loading the vocals…')).toBeNull();
    jest.useRealTimers();
  });
});

describe('review route', () => {
  const layout = {
    default: function Layout() {
      return (
        <IntlProvider locale="en">
          <Slot />
        </IntlProvider>
      );
    },
  };

  it('a missing review is final, with friendly copy and Retry', async () => {
    jest.useRealTimers();
    gen.startReview!.mockRejectedValue(new ApiError(404, 'nope'));
    renderRouter({ _layout: layout, 'review/[id]': { default: ReviewRoute } }, { initialUrl: '/review/j1' });
    expect(await screen.findByText("We couldn't find this review.")).toBeTruthy();
    expect(screen.queryByText(/access denied/i)).toBeNull();
    gen.startReview!.mockResolvedValue(undefined);
    gen.getCorrectionData!.mockResolvedValue(cleanFixture());
    fireEvent.press(screen.getByTestId('review-retry'));
    expect(await screen.findByTestId('review-screen')).toBeTruthy();
  });
});
