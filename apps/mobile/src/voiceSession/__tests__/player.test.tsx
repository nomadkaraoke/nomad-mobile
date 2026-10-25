// Voice session karaoke player (Phase 3d D3): the embedded YouTube page (spike player C), the link-out card with its
// "Done singing?" reminder, and the fake player E2E uses.
import { IntlProvider } from '@nomad/i18n';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';

import * as media from '../../media/youtube';
import * as notifications from '../player/notifications';
import { KaraokePlayer, type KaraokePlayerHandle, type PlayerEvent } from '../player/KaraokePlayer';
import { allowEmbedLoad, playerHtml } from '../player/YouTubeEmbed';

const mockInject = jest.fn();
const mockReload = jest.fn();
let mockWebViewProps: Record<string, unknown> = {};
jest.mock('react-native-webview', () => {
  const { useImperativeHandle } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  function WebView(props: Record<string, unknown> & { ref?: unknown; testID?: string }) {
    mockWebViewProps = props;
    useImperativeHandle(props.ref, () => ({ injectJavaScript: mockInject, reload: mockReload }));
    return <View testID={props.testID} />;
  }
  return { WebView };
});

jest.mock('../../config', () => ({ ...jest.requireActual('../../config'), FAKE_YT: false, FAKE_YT_SECONDS: 5 }));
// The components read `config.FAKE_YT` at render time, so flipping the mock's export switches the player.
const config = jest.requireMock('../../config') as { FAKE_YT: boolean };

jest.mock('../../media/youtube', () => {
  const actual = jest.requireActual('../../media/youtube');
  return { ...actual, openYouTubeUrl: jest.fn(actual.openYouTubeUrl) };
});
const openYouTubeUrl = media.openYouTubeUrl as jest.Mock;

jest.mock('../player/notifications', () => ({
  ensureLocalPermission: jest.fn(async () => true),
  scheduleBackNotification: jest.fn(async () => 'back-id'),
  cancelBackNotification: jest.fn(async () => {}),
}));
const N = notifications as jest.Mocked<typeof notifications>;

const VIDEO = '6X2eVajeqz8';

function show(mode: 'embed-hosted' | 'linkout', over: { videoId?: string; durationS?: number | null } = {}) {
  const onEvent = jest.fn<void, [PlayerEvent]>();
  const ref = createRef<KaraokePlayerHandle>();
  render(
    <IntlProvider locale="en">
      <KaraokePlayer ref={ref} videoId={over.videoId ?? VIDEO} durationS={over.durationS === undefined ? 200 : over.durationS} mode={mode} onEvent={onEvent} testID="vs-player" />
    </IntlProvider>,
  );
  return { onEvent, ref };
}

const PAGE_URL = 'https://nomadkaraoke.com/';
const message = (m: object, url = PAGE_URL) =>
  act(() => (mockWebViewProps.onMessage as (e: unknown) => void)({ nativeEvent: { data: JSON.stringify(m), url } }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  config.FAKE_YT = false;
  mockWebViewProps = {};
});

describe('YouTubeEmbed (embed-hosted)', () => {
  it('loads our own IFrame API page with the nomadkaraoke.com base URL (no Error 153) and inline playback', () => {
    show('embed-hosted');
    expect(screen.getByTestId('vs-player-embed')).toBeTruthy();
    const source = mockWebViewProps.source as { html: string; baseUrl: string };
    expect(source.baseUrl).toBe('https://nomadkaraoke.com');
    expect(source.html).toContain(`"${VIDEO}"`);
    expect(source.html).toContain("origin: 'https://nomadkaraoke.com'");
    expect(mockWebViewProps.allowsInlineMediaPlayback).toBe(true);
    expect(mockWebViewProps.mediaPlaybackRequiresUserAction).toBe(false);
  });

  it('never autoplays: the page waits for play() (iOS pauses the video when the mic stream starts)', () => {
    const html = playerHtml(VIDEO);
    expect(html).not.toMatch(/autoplay\s*:\s*1/);
    // playVideo only appears in the command handler, never in onReady.
    expect(html.match(/playVideo/g)).toHaveLength(1);
  });

  it('maps ready, playing (once) and ended', () => {
    const { onEvent } = show('embed-hosted');
    message({ t: 'ready' });
    message({ t: 'state', v: 3 });
    message({ t: 'state', v: 1 });
    message({ t: 'state', v: 2 });
    message({ t: 'state', v: 1 });
    message({ t: 'time', v: 12.5 });
    message({ t: 'state', v: 0 });
    expect(onEvent.mock.calls.map(([e]) => e)).toEqual([{ kind: 'ready' }, { kind: 'playing' }, { kind: 'ended' }]);
  });

  it('embed error 150 calls onUnplayable', () => {
    const { onEvent } = show('embed-hosted');
    message({ t: 'ready' });
    message({ t: 'error', v: 150 });
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'unplayable', code: 150 });
  });

  it.each([2, 5, 100, 101, 152, 153, 999])('error %p is unplayable', (code) => {
    const { onEvent } = show('embed-hosted');
    message({ t: 'error', v: code });
    expect(onEvent).toHaveBeenCalledWith({ kind: 'unplayable', code });
  });

  it('an error without a code (Error 153 without a referrer) is unplayable too, reported once', () => {
    const { onEvent } = show('embed-hosted');
    message({ t: 'error' });
    message({ t: 'error', v: 150 });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ kind: 'unplayable', code: 'unknown' });
  });

  it('ignores messages that are not ours', () => {
    const { onEvent } = show('embed-hosted');
    act(() => (mockWebViewProps.onMessage as (e: unknown) => void)({ nativeEvent: { data: 'not json', url: PAGE_URL } }));
    message({ t: 'something' });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('reports ready once, even if the page posts it again', () => {
    const { onEvent } = show('embed-hosted');
    message({ t: 'ready' });
    message({ t: 'ready' });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('ignores messages from any page but ours (a navigated-away youtube.com page)', () => {
    const { onEvent } = show('embed-hosted');
    message({ t: 'error', v: 150 }, 'https://www.youtube.com/watch?v=6X2eVajeqz8');
    message({ t: 'ready' }, 'https://nomadkaraoke.com.evil.example/');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('stays on our page: only https origins, no new windows, reload when iOS kills the web process', () => {
    show('embed-hosted');
    expect(mockWebViewProps.originWhitelist).toEqual(['https://*']);
    expect(mockWebViewProps.setSupportMultipleWindows).toBe(false);
    expect(mockWebViewProps.onShouldStartLoadWithRequest).toBe(allowEmbedLoad);
    (mockWebViewProps.onContentProcessDidTerminate as () => void)();
    expect(mockReload).toHaveBeenCalled();
  });

  it('a top-frame youtube.com watch request is blocked and opens in YouTube instead', () => {
    expect(allowEmbedLoad({ url: 'https://www.youtube.com/watch?v=6X2eVajeqz8', isTopFrame: true })).toBe(false);
    expect(openYouTubeUrl).toHaveBeenCalledWith('https://www.youtube.com/watch?v=6X2eVajeqz8');
  });

  it('blocks other top-frame pages without opening anything', () => {
    expect(allowEmbedLoad({ url: 'https://accounts.google.com/signin', isTopFrame: true })).toBe(false);
    expect(allowEmbedLoad({ url: 'https://www.youtube.com/', isTopFrame: true })).toBe(false);
    expect(openYouTubeUrl).not.toHaveBeenCalled();
  });

  it.each([
    { url: 'https://nomadkaraoke.com/', isTopFrame: true },
    { url: 'https://nomadkaraoke.com', isTopFrame: true },
    { url: 'about:blank', isTopFrame: true },
    { url: 'https://www.youtube.com/embed/6X2eVajeqz8?origin=x', isTopFrame: true },
    { url: 'https://googleads.g.doubleclick.net/pagead/id', isTopFrame: false },
  ])('allows our page, about:blank, the player iframe and sub-frame loads (%j)', (req) => {
    expect(allowEmbedLoad(req)).toBe(true);
    expect(openYouTubeUrl).not.toHaveBeenCalled();
  });

  it('a link that opens a new window goes to YouTube too', () => {
    show('embed-hosted');
    (mockWebViewProps.onOpenWindow as (e: unknown) => void)({ nativeEvent: { targetUrl: 'https://youtu.be/6X2eVajeqz8' } });
    expect(openYouTubeUrl).toHaveBeenCalledWith('https://youtu.be/6X2eVajeqz8');
  });

  it('play() and pause() through the ref inject the player commands', () => {
    const { ref } = show('embed-hosted');
    act(() => ref.current!.play());
    expect(mockInject).toHaveBeenLastCalledWith(expect.stringContaining("window.nomadCmd('play')"));
    act(() => ref.current!.pause());
    expect(mockInject).toHaveBeenLastCalledWith(expect.stringContaining("window.nomadCmd('pause')"));
  });

  it('an id that is not a YouTube id is unplayable without loading anything', () => {
    const { onEvent } = show('embed-hosted', { videoId: "x');alert(1)//" });
    expect(onEvent).toHaveBeenCalledWith({ kind: 'unplayable', code: 2 });
    expect(mockWebViewProps.source).toBeUndefined();
  });
});

describe('LinkOutPlayer', () => {
  let appStateListener: (s: AppStateStatus) => void = () => {};
  const remove = jest.fn();
  beforeEach(() => {
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, l) => {
      appStateListener = l as (s: AppStateStatus) => void;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  const open = () => act(async () => fireEvent.press(screen.getByTestId('vs-linkout-open')));

  it('is ready at once; "Open in YouTube" asks permission, schedules the reminder, then opens the watch URL', async () => {
    const { onEvent } = show('linkout');
    expect(onEvent).toHaveBeenCalledWith({ kind: 'ready' });
    expect(screen.getByTestId('vs-linkout-open')).toHaveTextContent('Open in YouTube');
    await open();
    expect(N.ensureLocalPermission).toHaveBeenCalled();
    expect(N.scheduleBackNotification).toHaveBeenCalledWith(200, {
      title: 'Done singing?',
      body: 'Tap to rate it and get your next song',
      channelName: expect.any(String),
    });
    expect(N.ensureLocalPermission.mock.invocationCallOrder[0]!).toBeLessThan(N.scheduleBackNotification.mock.invocationCallOrder[0]!);
    expect(Linking.openURL).toHaveBeenCalledWith(`https://www.youtube.com/watch?v=${VIDEO}`);
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'playing' });
  });

  it('linkout schedules notification at duration+10: passes the song duration (null when unknown)', async () => {
    show('linkout', { durationS: null });
    await open();
    expect(N.scheduleBackNotification).toHaveBeenCalledWith(null, expect.anything());
  });

  it('opens YouTube without a reminder when notifications are declined', async () => {
    N.ensureLocalPermission.mockResolvedValueOnce(false);
    show('linkout');
    await open();
    expect(N.scheduleBackNotification).not.toHaveBeenCalled();
    expect(Linking.openURL).toHaveBeenCalled();
  });

  it('returning to foreground ends and cancels', async () => {
    const { onEvent } = show('linkout');
    await open();
    await act(async () => appStateListener('background'));
    expect(onEvent).not.toHaveBeenCalledWith({ kind: 'ended' });
    await act(async () => appStateListener('active'));
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'ended' });
    expect(N.cancelBackNotification).toHaveBeenCalledWith('back-id');
    await act(async () => appStateListener('background'));
    await act(async () => appStateListener('active'));
    expect(onEvent.mock.calls.filter(([e]) => e.kind === 'ended')).toHaveLength(1);
  });

  it('an "active" without having left the app (e.g. after the permission prompt) does not end the song', async () => {
    const { onEvent } = show('linkout');
    await act(async () => appStateListener('inactive'));
    await act(async () => appStateListener('active'));
    expect(onEvent).not.toHaveBeenCalledWith({ kind: 'ended' });
  });

  it('"I\'m back" ends and cancels the reminder', async () => {
    const { onEvent } = show('linkout');
    await open();
    await act(async () => fireEvent.press(screen.getByTestId('vs-linkout-back')));
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'ended' });
    expect(N.cancelBackNotification).toHaveBeenCalledWith('back-id');
  });

  it('unmounted during the permission prompt: nothing is scheduled or opened', async () => {
    let grant: (v: boolean) => void = () => {};
    N.ensureLocalPermission.mockImplementationOnce(() => new Promise<boolean>((res) => (grant = res)));
    show('linkout');
    fireEvent.press(screen.getByTestId('vs-linkout-open'));
    screen.unmount();
    await act(async () => grant(true));
    expect(N.scheduleBackNotification).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('unmounted while scheduling: the new reminder is cancelled and YouTube is not opened', async () => {
    let scheduled: (v: string | null) => void = () => {};
    N.scheduleBackNotification.mockImplementationOnce(() => new Promise<string | null>((res) => (scheduled = res)));
    show('linkout');
    await act(async () => fireEvent.press(screen.getByTestId('vs-linkout-open')));
    screen.unmount();
    await act(async () => scheduled('late-id'));
    expect(N.cancelBackNotification).toHaveBeenCalledWith('late-id');
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('no playing after the song already ended (returned before openURL resolved)', async () => {
    let opened: (v: boolean) => void = () => {};
    (Linking.openURL as jest.Mock).mockImplementationOnce(() => new Promise<boolean>((res) => (opened = res)));
    const { onEvent } = show('linkout');
    await act(async () => fireEvent.press(screen.getByTestId('vs-linkout-open')));
    await act(async () => appStateListener('background'));
    await act(async () => appStateListener('active'));
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'ended' });
    await act(async () => opened(true));
    expect(onEvent).not.toHaveBeenCalledWith({ kind: 'playing' });
  });

  it('cancels the reminder when YouTube fails to open, and stays on the card', async () => {
    (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error('no handler'));
    const { onEvent } = show('linkout');
    await open();
    expect(N.cancelBackNotification).toHaveBeenCalledWith('back-id');
    expect(onEvent).not.toHaveBeenCalledWith({ kind: 'playing' });
    expect(screen.getByTestId('vs-linkout-open')).toBeTruthy();
  });
});

describe('FakePlayer (FAKE_YT)', () => {
  it('FAKE_YT wins over the mode', () => {
    config.FAKE_YT = true;
    show('linkout');
    expect(screen.getByTestId('vs-fake-player')).toBeTruthy();
    expect(screen.queryByTestId('vs-linkout-open')).toBeNull();
  });

  it('fake player ends after 5 s: ready, then playing on play(), then ended', () => {
    jest.useFakeTimers();
    config.FAKE_YT = true;
    const { onEvent, ref } = show('embed-hosted');
    expect(onEvent.mock.calls.map(([e]) => e)).toEqual([{ kind: 'ready' }]);
    act(() => ref.current!.play());
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'playing' });
    act(() => jest.advanceTimersByTime(4999));
    expect(onEvent).not.toHaveBeenCalledWith({ kind: 'ended' });
    act(() => jest.advanceTimersByTime(1));
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'ended' });
    // A second play() after the end does nothing.
    act(() => ref.current!.play());
    expect(onEvent).toHaveBeenCalledTimes(3);
  });
});
