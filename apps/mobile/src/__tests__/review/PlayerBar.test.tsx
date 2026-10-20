import { IntlProvider } from '@nomad/i18n';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ReviewPlayer } from '../../review/audio/useReviewPlayer';
import { PlayerBar } from '../../review/lyrics/PlayerBar';
import type { VocalsPeaks } from '../../review/lyrics/useVocalsPeaks';
import { fakePlayer } from '../../test-utils/reviewFixtures';

// The player hook pulls in expo-audio; PlayerBar only needs its types.
jest.mock('../../review/audio/useReviewPlayer', () => ({}));

const READY: VocalsPeaks = { status: 'ready', peaks: [0.2, 0.5, 0.9], duration: 60 };

function renderBar(over: Record<string, unknown> = {}, props: Partial<Parameters<typeof PlayerBar>[0]> = {}) {
  const player = fakePlayer({ position: 20, ...over });
  const onFollow = jest.fn();
  render(
    <IntlProvider locale="en">
      <PlayerBar
        player={player as unknown as ReviewPlayer}
        peaks={READY}
        vocalsReady
        markers={[]}
        follow
        onFollow={onFollow}
        {...props}
      />
    </IntlProvider>,
  );
  return { player, onFollow };
}

describe('PlayerBar', () => {
  it('play/pause toggles the player and is labelled by state', () => {
    const { player } = renderBar();
    expect(screen.getByTestId('review-player-play').props.accessibilityLabel).toBe('Play');
    fireEvent.press(screen.getByTestId('review-player-play'));
    expect(player.toggle).toHaveBeenCalled();
  });

  it('labels pause while playing', () => {
    renderBar({ playing: true });
    expect(screen.getByTestId('review-player-play').props.accessibilityLabel).toBe('Pause');
  });

  it('back 5 s seeks back, floored at 0', () => {
    const { player } = renderBar({ position: 3 });
    fireEvent.press(screen.getByTestId('review-player-back5'));
    expect(player.seekTo).toHaveBeenCalledWith(0);
  });

  it('shows position and duration', () => {
    renderBar({ position: 65, duration: 200 });
    expect(screen.getByText('1:05 / 3:20')).toBeTruthy();
  });

  it('the scrubber seeks by fraction of the duration', () => {
    const { player } = renderBar({ position: 30, duration: 60 });
    fireEvent(screen.getByTestId('review-player-scrub'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(player.seekTo).toHaveBeenCalledWith(33);
  });

  it('switches source between Song and Vocals', () => {
    const { player } = renderBar();
    expect(screen.getByTestId('review-player-source')).toHaveTextContent('Song');
    fireEvent.press(screen.getByTestId('review-player-source'));
    expect(player.setSource).toHaveBeenCalledWith('vocals');
  });

  it('vocals wait for the stems', () => {
    const { player } = renderBar({}, { vocalsReady: false });
    expect(screen.getByTestId('review-player-source')).toHaveTextContent('Vocals soon');
    fireEvent.press(screen.getByTestId('review-player-source'));
    expect(player.setSource).not.toHaveBeenCalled();
  });

  it('toggles speed between 1× and 0.75×', () => {
    const { player } = renderBar();
    expect(screen.getByTestId('review-player-rate')).toHaveTextContent('1×');
    fireEvent.press(screen.getByTestId('review-player-rate'));
    expect(player.setRate).toHaveBeenCalledWith(0.75);
  });

  it('back to 1× from 0.75×', () => {
    const { player } = renderBar({ rate: 0.75 });
    fireEvent.press(screen.getByTestId('review-player-rate'));
    expect(player.setRate).toHaveBeenCalledWith(1);
  });

  it('shows the Follow pill only when not following', () => {
    renderBar();
    expect(screen.queryByTestId('review-player-follow')).toBeNull();
  });

  it('Follow resumes following', () => {
    const { onFollow } = renderBar({}, { follow: false });
    fireEvent.press(screen.getByTestId('review-player-follow'));
    expect(onFollow).toHaveBeenCalled();
  });

  it('labels a pending waveform', () => {
    renderBar({}, { peaks: { status: 'pending', peaks: [], duration: 0 } });
    expect(screen.getByText('Loading the vocals…')).toBeTruthy();
  });

  it.each([
    ['load_failed', "We couldn't load the audio. Check your connection and try again."],
    ['play_failed', "We couldn't play the audio. Tap play to try again."],
  ])('maps the %s player error to friendly copy', (code, copy) => {
    renderBar({ error: code });
    expect(screen.getByTestId('review-player-error')).toHaveTextContent(copy);
    expect(screen.queryByText(/access denied/i)).toBeNull();
  });
});
