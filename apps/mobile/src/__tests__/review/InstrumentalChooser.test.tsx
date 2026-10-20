import { WaveformCanvas } from '@nomad/ui';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { InstrumentalChooser } from '../../review/finish/InstrumentalChooser';
import { cleanFixture, fakeAbPlayers, readyStems, renderReview } from '../../test-utils/reviewFixtures';

let mockAb = fakeAbPlayers();
const mockAbOptions = jest.fn();
jest.mock('../../review/audio/useAbPlayers', () => ({
  useAbPlayers: (jobId: string, options: unknown) => {
    mockAbOptions(jobId, options);
    return mockAb;
  },
}));

jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getWaveformData: jest.fn(),
}));
const gen = jest.requireMock('@nomad/api-gen') as Record<string, jest.Mock>;

const CONFIDENT = { backing: { confident: true, resolved_selection: 'clean' } };

beforeEach(() => {
  jest.clearAllMocks();
  (jest.requireMock('react-native-mmkv') as { __resetMMKV(): void }).__resetMMKV();
  mockAb = fakeAbPlayers();
  gen.getWaveformData!.mockResolvedValue({ amplitudes: [0.1, 0.5, 0.9], duration: 30 });
});

async function renderChooser(stems = readyStems()) {
  const utils = renderReview(<InstrumentalChooser jobId="j1" stems={stems} />, cleanFixture());
  await act(async () => {}); // the backing waveform fetch
  return utils;
}

const selected = (id: string) => screen.getByTestId(`review-choice-${id}`).props.accessibilityState.selected;

describe('InstrumentalChooser', () => {
  it('not confident: preselects the recommendation with no badge, and asks to listen', async () => {
    await renderChooser(); // analysis recommends with_backing, no confident verdict
    expect(selected('with_backing')).toBe(true);
    expect(selected('clean')).toBe(false);
    expect(screen.queryByTestId('review-choice-with_backing-recommended')).toBeNull();
    expect(screen.getByText('Have a listen and choose')).toBeTruthy();
    expect(screen.getByText("If you can hear the lead singer's voice coming through, choose Clean.")).toBeTruthy();
  });

  it('confident: collapses to one line; Change shows the cards with the recommended one badged', async () => {
    await renderChooser(readyStems({ autoApproval: CONFIDENT }));
    expect(screen.getByTestId('review-choice-summary')).toHaveTextContent('Instrumental: Clean ✓');
    expect(screen.queryByTestId('review-choice-clean')).toBeNull();
    fireEvent.press(screen.getByTestId('review-choice-change'));
    await act(async () => {}); // the strip mounts with the cards
    expect(selected('clean')).toBe(true);
    expect(screen.getByTestId('review-choice-clean-recommended')).toHaveTextContent('✓ Recommended');
    expect(screen.queryByTestId('review-choice-with_backing-recommended')).toBeNull();
  });

  it('picking a card records the choice in the store', async () => {
    const { store } = await renderChooser();
    fireEvent.press(screen.getByTestId('review-choice-clean'));
    expect(store.getState().selection).toBe('clean');
    expect(store.getState().selectionTouched).toBe(true);
    expect(selected('clean')).toBe(true);
    expect(mockAb.setActive).not.toHaveBeenCalled(); // not listening: nothing to switch
  });

  it('stems still separating: a spinner instead of the cards, and no players yet', async () => {
    await renderChooser(readyStems({ ready: false, audioComplete: false }));
    expect(screen.getByTestId('review-stems-pending')).toHaveTextContent('Separating the music… usually 2–3 minutes');
    expect(screen.queryByTestId('review-choice-clean')).toBeNull();
    expect(mockAbOptions).toHaveBeenLastCalledWith('j1', []);
    expect(gen.getWaveformData).not.toHaveBeenCalled(); // before the stems land gen would send the mix
  });

  it('▶ plays the stem; pressing B while A plays switches what you hear without seeking', async () => {
    await renderChooser();
    fireEvent.press(screen.getByTestId('review-choice-play-clean'));
    expect(mockAb.setActive).toHaveBeenCalledWith('clean');
    expect(mockAb.play).toHaveBeenCalledTimes(1);

    mockAb = fakeAbPlayers({ playing: true, active: 'clean', position: 12 });
    fireEvent.press(screen.getByTestId('review-choice-clean')); // re-render with the playing fake
    jest.clearAllMocks();
    fireEvent.press(screen.getByTestId('review-choice-play-with_backing'));
    expect(mockAb.setActive).toHaveBeenCalledWith('with_backing');
    expect(mockAb.seekTo).not.toHaveBeenCalled();
    expect(mockAb.play).not.toHaveBeenCalled();
    expect(mockAb.pause).not.toHaveBeenCalled();
  });

  it('▶ on the stem that is playing pauses it; a card tap while playing switches the stem too', async () => {
    mockAb = fakeAbPlayers({ playing: true, active: 'with_backing' });
    await renderChooser();
    fireEvent.press(screen.getByTestId('review-choice-play-with_backing'));
    expect(mockAb.pause).toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('review-choice-clean'));
    expect(mockAb.setActive).toHaveBeenCalledWith('clean');
  });

  it('the shared scrubber seeks both stems', async () => {
    mockAb = fakeAbPlayers({ duration: 100 });
    await renderChooser();
    const scrub = screen.getByTestId('review-ab-scrub');
    fireEvent(scrub, 'layout', { nativeEvent: { layout: { width: 200, height: 44, x: 0, y: 0 } } });
    fireEvent.press(scrub, { nativeEvent: { locationX: 50 } });
    expect(mockAb.seekTo).toHaveBeenCalledWith(25);
  });

  it('a tap on a highlighted part of the backing strip selects With backing and plays from there', async () => {
    const { store } = await renderChooser(readyStems({ autoApproval: undefined, analysis: { ...readyStems().analysis, recommended_selection: 'clean' } }));
    expect(selected('clean')).toBe(true);
    expect(screen.getByTestId('review-backing-strip')).toBeTruthy();
    const strip = screen.UNSAFE_getByType(WaveformCanvas);
    expect(strip.props.markers).toEqual([expect.objectContaining({ from: 10 / 30, to: 20 / 30 })]);

    // Outside the highlighted region (with a fingertip's tolerance): nothing happens.
    act(() => strip.props.onSeek(0.1));
    expect(mockAb.seekTo).not.toHaveBeenCalled();

    await act(async () => strip.props.onSeek(0.5)); // 15 s, inside 10–20 s
    expect(store.getState().selection).toBe('with_backing');
    expect(mockAb.setActive).toHaveBeenCalledWith('with_backing');
    expect(mockAb.seekTo).toHaveBeenCalledWith(15);
    expect(mockAb.play).toHaveBeenCalled();
    expect(mockAb.seekTo.mock.invocationCallOrder[0]).toBeLessThan(mockAb.play.mock.invocationCallOrder[0]!);
  });

  it('no audible backing vocals: no strip', async () => {
    await renderChooser(readyStems({ analysis: { ...readyStems().analysis, audible_segments: [], has_audible_content: false } }));
    expect(screen.queryByTestId('review-backing-strip')).toBeNull();
  });

  it('shows a stem load error', async () => {
    mockAb = fakeAbPlayers({ error: 'load_failed' });
    await renderChooser();
    expect(screen.getByTestId('review-ab-error')).toHaveTextContent(/^We couldn't load the audio/);
  });
});
