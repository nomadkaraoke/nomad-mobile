import { ApiError } from '@nomad/api-gen';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { createAudioPlayer } from 'expo-audio';

import { PREVIEW_POLL_MS, PREVIEW_SLOW_MS } from '../../review/finish/usePreview';
import { AudioFocusContext, createAudioFocus } from '../../review/finish/audioFocus';
import { PreviewPanel } from '../../review/finish/PreviewPanel';
import { cleanFixture, renderReview } from '../../test-utils/reviewFixtures';

type Listener = (e?: { isPlaying: boolean }) => void;
const mockVideo = {
  pause: jest.fn(),
  muted: false,
  currentTime: 12,
  playing: true,
  audioMixingMode: 'auto',
  listeners: [] as Listener[],
  addListener: jest.fn((_: string, l: Listener) => {
    mockVideo.listeners.push(l);
    return { remove: () => (mockVideo.listeners = mockVideo.listeners.filter((x) => x !== l)) };
  }),
};
const mockUseVideoPlayer = jest.fn();
jest.mock('expo-video', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    useVideoPlayer: (uri: string, setup?: (p: unknown) => void) => {
      mockUseVideoPlayer(uri);
      setup?.(mockVideo);
      return mockVideo;
    },
    VideoView: (props: Record<string, unknown>) => createElement(View, props),
  };
});

jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  requestPreview: jest.fn(),
  getPreviewStatus: jest.fn(),
}));
const gen = jest.requireMock('@nomad/api-gen') as Record<string, jest.Mock>;
const audio = createAudioPlayer as jest.Mock;

const STEM = 'http://api/stem/clean.ogg';

function renderPanel(props: Partial<Parameters<typeof PreviewPanel>[0]> = {}) {
  const onBackToLyrics = jest.fn();
  const utils = renderReview(<PreviewPanel jobId="j1" stemUri={STEM} onBackToLyrics={onBackToLyrics} {...props} />, cleanFixture());
  return { ...utils, onBackToLyrics };
}

const start = async () => {
  await act(async () => fireEvent.press(screen.getByTestId('review-preview-start')));
};

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockVideo.muted = false;
  mockVideo.listeners = [];
});

describe('PreviewPanel', () => {
  it('a cached render (success) is ready at once; the URL is the preview proxy path', async () => {
    gen.requestPreview!.mockResolvedValue({ status: 'success', previewHash: 'abc' });
    renderPanel();
    await start();
    expect(gen.requestPreview).toHaveBeenCalledWith('j1', expect.objectContaining({ corrected_segments: expect.any(Array) }), undefined);
    expect(screen.getByTestId('review-preview-player')).toBeTruthy();
    expect(mockUseVideoPlayer).toHaveBeenCalledWith(expect.stringContaining('/api/review/j1/preview-video/abc'));
    expect(mockVideo.audioMixingMode).toBe('mixWithOthers');
    expect(gen.getPreviewStatus).not.toHaveBeenCalled();
  });

  it('generating: polls every 3 s, shows the cold-server copy after 30 s, then plays when ready', async () => {
    jest.useFakeTimers();
    gen.requestPreview!.mockResolvedValue({ status: 'generating', previewHash: 'h' });
    gen.getPreviewStatus!.mockResolvedValue('generating');
    renderPanel();
    await start();
    expect(screen.getByTestId('review-preview-generating')).toHaveTextContent('Making your preview…');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PREVIEW_POLL_MS);
    });
    expect(gen.getPreviewStatus).toHaveBeenCalledTimes(1);
    expect(gen.getPreviewStatus).toHaveBeenCalledWith('j1', 'h');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PREVIEW_SLOW_MS);
    });
    expect(screen.getByTestId('review-preview-generating')).toHaveTextContent(
      'Starting a video server, this can take a couple of minutes',
    );
    gen.getPreviewStatus!.mockResolvedValue('ready');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PREVIEW_POLL_MS);
    });
    expect(screen.getByTestId('review-preview-player')).toBeTruthy();
    jest.useRealTimers();
  });

  it('a failed status poll is retried; an error status offers Try again', async () => {
    jest.useFakeTimers();
    gen.requestPreview!.mockResolvedValue({ status: 'generating', previewHash: 'h' });
    gen.getPreviewStatus!.mockRejectedValueOnce(new ApiError(0, 'offline')).mockResolvedValueOnce('error');
    renderPanel();
    await start();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PREVIEW_POLL_MS * 2);
    });
    expect(gen.getPreviewStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('review-preview-error')).toBeTruthy();
    gen.requestPreview!.mockResolvedValue({ status: 'success', previewHash: 'h2' });
    await act(async () => fireEvent.press(screen.getByTestId('review-preview-retry')));
    expect(screen.getByTestId('review-preview-player')).toBeTruthy();
    jest.useRealTimers();
  });

  it('gives up after 5 minutes of generating', async () => {
    jest.useFakeTimers();
    gen.requestPreview!.mockResolvedValue({ status: 'generating', previewHash: 'h' });
    gen.getPreviewStatus!.mockResolvedValue('generating');
    renderPanel();
    await start();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5 * 60_000 + PREVIEW_POLL_MS);
    });
    expect(screen.getByTestId('review-preview-error')).toBeTruthy();
    const calls = gen.getPreviewStatus!.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PREVIEW_POLL_MS * 3);
    });
    expect(gen.getPreviewStatus).toHaveBeenCalledTimes(calls); // stopped
    jest.useRealTimers();
  });

  it('a 422 (untimed lines) offers Back to lyrics', async () => {
    gen.requestPreview!.mockRejectedValue(new ApiError(422, 'untimed'));
    const { onBackToLyrics } = renderPanel();
    await start();
    expect(screen.getByTestId('review-preview-untimed')).toBeTruthy();
    fireEvent.press(screen.getByTestId('review-preview-back'));
    expect(onBackToLyrics).toHaveBeenCalled();
  });

  it('notes it is a black-background sync check, plus the translation when the job has one', async () => {
    gen.requestPreview!.mockResolvedValue({ status: 'success', previewHash: 'abc' });
    renderPanel({ translationLanguage: 'es' });
    await start();
    expect(screen.getByText(/plain black background\. Your Español translation is added after review\.$/)).toBeTruthy();
  });

  it('Instrumental mutes the video and plays the chosen stem from the video position; Song undoes it', async () => {
    gen.requestPreview!.mockResolvedValue({ status: 'success', previewHash: 'abc' });
    renderPanel();
    await start();
    expect(audio).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('review-preview-audio-instrumental'));
    expect(screen.getByTestId('review-preview-audio-instrumental').props.accessibilityState.selected).toBe(true);
    expect(mockVideo.muted).toBe(true);
    expect(audio).toHaveBeenCalledWith({ uri: STEM });
    const stem = audio.mock.results[0]!.value;
    expect(stem.seekTo).toHaveBeenCalledWith(12);
    expect(stem.play).toHaveBeenCalled(); // the video is playing

    // The stem follows the video's play/pause.
    mockVideo.playing = false;
    act(() => mockVideo.listeners.forEach((l) => l({ isPlaying: false })));
    expect(stem.pause).toHaveBeenCalled();
    mockVideo.playing = true;

    fireEvent.press(screen.getByTestId('review-preview-audio-song'));
    expect(mockVideo.muted).toBe(false);
    expect(stem.remove).toHaveBeenCalled();
    expect(mockVideo.listeners).toHaveLength(1); // only the player's own playing-state listener remains
  });

  it('no stem (e.g. the singer\'s own instrumental): no audio toggle', async () => {
    gen.requestPreview!.mockResolvedValue({ status: 'success', previewHash: 'abc' });
    renderPanel({ stemUri: null });
    await start();
    expect(screen.queryByTestId('review-preview-audio-instrumental')).toBeNull();
  });

  it('one sound at a time: the preview starting pauses the A/B stems, and the stems starting pause the preview', async () => {
    gen.requestPreview!.mockResolvedValue({ status: 'success', previewHash: 'abc' });
    const focus = createAudioFocus();
    const pauseAb = jest.fn();
    focus.register('ab', pauseAb);
    renderReview(
      <AudioFocusContext.Provider value={focus}>
        <PreviewPanel jobId="j1" stemUri={STEM} onBackToLyrics={jest.fn()} />
      </AudioFocusContext.Provider>,
      cleanFixture(),
    );
    await start();
    act(() => mockVideo.listeners.forEach((l) => l({ isPlaying: true })));
    expect(pauseAb).toHaveBeenCalledTimes(1);
    act(() => focus.claim('ab'));
    expect(mockVideo.pause).toHaveBeenCalled();
  });

  it('tells the step when the preview is ready (so it can scroll it into view)', async () => {
    gen.requestPreview!.mockResolvedValue({ status: 'success', previewHash: 'abc' });
    const onReady = jest.fn();
    renderPanel({ onReady });
    await start();
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
