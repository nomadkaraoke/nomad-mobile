import { ApiError } from '@nomad/api-gen';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { ScrollView } from 'react-native';

import { loadDraft } from '../../review/drafts';
import { FinishStep } from '../../review/finish/FinishStep';
import { useInstrumentalChoice } from '../../review/finish/InstrumentalChooser';
import { SUCCESS_HOLD_MS, useSubmitReview } from '../../review/finish/useSubmitReview';
import { cleanFixture, correctionsFixture, fakeAbPlayers, readyStems, renderReview } from '../../test-utils/reviewFixtures';

const mockAb = fakeAbPlayers();
jest.mock('../../review/audio/useAbPlayers', () => ({ useAbPlayers: () => mockAb }));
jest.mock('expo-router', () => ({ router: { dismissTo: jest.fn() } }));

jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getWaveformData: jest.fn(() => new Promise(() => {})),
  getJob: jest.fn(),
  saveCorrections: jest.fn(),
  getCorrectionData: jest.fn(),
  completeReview: jest.fn(),
  requestPreview: jest.fn(),
}));
const gen = jest.requireMock('@nomad/api-gen') as Record<string, jest.Mock>;

const CONFIDENT = { backing: { confident: true, resolved_selection: 'clean' } };
const FRESH = cleanFixture({ corrections_made: 99 }); // what gen sends back after sanitizing

type FinishProps = Partial<Omit<Parameters<typeof FinishStep>[0], 'submitter'>>;

/** FinishStep with "Make my video" held by its parent, as ReviewBody does. */
function Harness({ stems = readyStems({ autoApproval: CONFIDENT }), showChooser = true, ...rest }: FinishProps) {
  const choice = useInstrumentalChoice(stems);
  const submitter = useSubmitReview('j1', showChooser ? choice.submit : 'custom');
  return <FinishStep jobId="j1" stems={stems} showChooser={showChooser} submitter={submitter} onBackToLyrics={jest.fn()} {...rest} />;
}
const finish = (p: FinishProps = {}) => <Harness {...p} />;

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  (jest.requireMock('react-native-mmkv') as { __resetMMKV(): void }).__resetMMKV();
  gen.saveCorrections!.mockResolvedValue(undefined);
  gen.getCorrectionData!.mockResolvedValue(FRESH);
  gen.completeReview!.mockResolvedValue({ status: 'success' });
  gen.getJob!.mockResolvedValue({ job_id: 'j1', status: 'in_review', progress: 0 });
});

const submitButton = () => screen.getByTestId('review-finish-submit');
const disabled = () => submitButton().props.accessibilityState.disabled;

describe('FinishStep', () => {
  it('summarises the lyrics (approved as is) and shows no duet line for a solo song', () => {
    renderReview(finish(), cleanFixture());
    expect(screen.getByTestId('review-finish-lyrics')).toHaveTextContent('Lyrics: approved as is');
    expect(screen.queryByTestId('review-finish-duet')).toBeNull();
  });

  it('counts the fixes and shows the duet line', () => {
    const { store } = renderReview(finish(), cleanFixture({ is_duet: true }));
    act(() => store.getState().apply((d) => ({ ...d, segments: d.segments.slice(1) })));
    expect(screen.getByTestId('review-finish-lyrics')).toHaveTextContent('Lyrics: 1 fix');
    expect(screen.getByTestId('review-finish-duet')).toHaveTextContent('Duet: 2 singers');
  });

  it('stems pending: spinner, Make my video waits with the waiting label; the stems landing enables it', () => {
    const { rerenderUi } = renderReview(finish({ stems: readyStems({ ready: false, audioComplete: false }) }), cleanFixture());
    expect(screen.getByTestId('review-stems-pending')).toBeTruthy();
    expect(disabled()).toBe(true);
    expect(submitButton()).toHaveTextContent('Waiting for the music to finish separating…');
    expect(screen.getByTestId('review-finish-waiting-hint')).toHaveTextContent(/You can leave now: we'll keep your edits/);
    fireEvent.press(submitButton());
    expect(gen.saveCorrections).not.toHaveBeenCalled();

    rerenderUi(finish({ stems: readyStems({ autoApproval: CONFIDENT }) }));
    expect(disabled()).toBe(false);
    expect(submitButton()).toHaveTextContent('Make my video');
    expect(screen.queryByTestId('review-finish-waiting-hint')).toBeNull();
  });

  it('untimed words block Make my video', () => {
    renderReview(finish(), correctionsFixture()); // one untimed word
    expect(disabled()).toBe(true);
    expect(screen.getByTestId('review-finish-untimed')).toHaveTextContent('1 word needs timing');
  });

  it('submit: corrections → fresh doc → complete, in order; auto for an unchanged confident pick, is_duet false', async () => {
    jest.useFakeTimers();
    const { queryClient } = renderReview(finish(), cleanFixture());
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    await act(async () => fireEvent.press(submitButton()));

    expect(gen.saveCorrections).toHaveBeenCalledTimes(1);
    const [jobId, corrections, isDuet] = gen.saveCorrections!.mock.calls[0]!;
    expect(jobId).toBe('j1');
    expect(corrections.corrected_segments).toHaveLength(2);
    expect(isDuet).toBeUndefined(); // Ruling M: not loaded as a duet, never toggled → omitted
    expect(gen.getCorrectionData).toHaveBeenCalledWith('j1');
    expect(gen.completeReview).toHaveBeenCalledWith('j1', FRESH, 'auto', false);
    const order = ['saveCorrections', 'getCorrectionData', 'completeReview'].map((f) => gen[f]!.mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    expect(screen.getByTestId('review-finish-success')).toHaveTextContent(/^Your video is on its way!/);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['jobs'] });
    expect(router.dismissTo).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(SUCCESS_HOLD_MS));
    // The Make tab, where the job card shows the render's progress.
    expect(router.dismissTo).toHaveBeenCalledWith('/make');
    jest.useRealTimers();
  });

  it('submit clears the draft', async () => {
    const { store } = renderReview(finish(), cleanFixture());
    act(() => store.getState().apply((d) => ({ ...d, segments: d.segments.slice(1) })));
    act(() => store.getState().flushDraft());
    expect(loadDraft('j1', 'h1')).not.toBeNull();
    await act(async () => fireEvent.press(submitButton()));
    expect(loadDraft('j1', 'h1')).toBeNull();
  });

  it('a loaded duet sends is_duet true on both calls', async () => {
    renderReview(finish(), cleanFixture({ is_duet: true }));
    await act(async () => fireEvent.press(submitButton()));
    expect(gen.saveCorrections!.mock.calls[0]![2]).toBe(true);
    expect(gen.completeReview!.mock.calls[0]![3]).toBe(true);
  });

  it('a duet toggled off is sent as false (known), not omitted', async () => {
    const { store } = renderReview(finish(), cleanFixture({ is_duet: true }));
    act(() => store.getState().setDuet(false));
    await act(async () => fireEvent.press(submitButton()));
    expect(gen.saveCorrections!.mock.calls[0]![2]).toBe(false);
  });

  it('a changed pick is sent as the stem, not auto', async () => {
    renderReview(finish(), cleanFixture());
    fireEvent.press(screen.getByTestId('review-choice-change'));
    fireEvent.press(screen.getByTestId('review-choice-with_backing'));
    await act(async () => fireEvent.press(submitButton()));
    expect(gen.completeReview!.mock.calls[0]![2]).toBe('with_backing');
  });

  it('an unconfident recommendation is sent as the stem', async () => {
    renderReview(finish({ stems: readyStems() }), cleanFixture()); // recommends with_backing, not confident
    await act(async () => fireEvent.press(submitButton()));
    expect(gen.completeReview!.mock.calls[0]![2]).toBe('with_backing');
  });

  it('the singer\'s own instrumental: no chooser, no wait for stems, sent as custom', async () => {
    renderReview(finish({ showChooser: false, stems: readyStems({ ready: false, options: [] }) }), cleanFixture());
    expect(screen.queryByTestId('review-stems-pending')).toBeNull();
    expect(disabled()).toBe(false);
    await act(async () => fireEvent.press(submitButton()));
    expect(gen.completeReview!.mock.calls[0]![2]).toBe('custom');
  });

  it('a double press submits once', async () => {
    let finishSave!: () => void;
    gen.saveCorrections!.mockReturnValue(new Promise<void>((r) => (finishSave = r)));
    renderReview(finish(), cleanFixture());
    fireEvent.press(submitButton());
    fireEvent.press(submitButton());
    expect(screen.getByTestId('review-finish-saving')).toHaveTextContent('Saving…');
    await act(async () => finishSave());
    await waitFor(() => expect(screen.getByTestId('review-finish-success')).toBeTruthy());
    expect(gen.saveCorrections).toHaveBeenCalledTimes(1);
    expect(gen.completeReview).toHaveBeenCalledTimes(1);
  });

  it('a 503 on complete shows Retry and keeps the draft; Retry succeeds', async () => {
    gen.completeReview!.mockRejectedValueOnce(new ApiError(503, 'busy'));
    const { store } = renderReview(finish(), cleanFixture());
    act(() => store.getState().apply((d) => ({ ...d, segments: d.segments.slice(1) })));
    await act(async () => fireEvent.press(submitButton()));

    expect(screen.getByTestId('review-finish-error')).toHaveTextContent("We couldn't start your video. Your edits are safe on this phone.");
    expect(screen.queryByTestId('review-finish-submit')).toBeNull();
    expect(loadDraft('j1', 'h1')).not.toBeNull(); // written at submit, kept on failure
    expect(router.dismissTo).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(screen.getByTestId('review-finish-retry')));
    expect(gen.saveCorrections).toHaveBeenCalledTimes(2); // the whole idempotent sequence again
    expect(gen.completeReview).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('review-finish-success')).toBeTruthy();
    expect(loadDraft('j1', 'h1')).toBeNull();
  });

  it('a dropped connection says so', async () => {
    gen.getCorrectionData!.mockRejectedValueOnce(new ApiError(0, 'Network request failed'));
    renderReview(finish(), cleanFixture());
    await act(async () => fireEvent.press(submitButton()));
    expect(screen.getByTestId('review-finish-error')).toHaveTextContent(/^Trouble reaching Nomad Karaoke/);
    expect(gen.completeReview).not.toHaveBeenCalled();
  });

  it('a lost complete response: Retry hits gen\'s 400 (job left review), gen says review_complete → success', async () => {
    gen.completeReview!.mockRejectedValueOnce(new ApiError(503, 'busy'));
    const { store } = renderReview(finish(), cleanFixture());
    act(() => store.getState().apply((d) => ({ ...d, segments: d.segments.slice(1) })));
    await act(async () => fireEvent.press(submitButton()));
    expect(screen.getByTestId('review-finish-error')).toBeTruthy();

    gen.saveCorrections!.mockRejectedValueOnce(new ApiError(400, 'Job not in review'));
    gen.getJob!.mockResolvedValue({ job_id: 'j1', status: 'review_complete', progress: 60 });
    await act(async () => fireEvent.press(screen.getByTestId('review-finish-retry')));
    expect(screen.getByTestId('review-finish-success')).toBeTruthy();
    expect(loadDraft('j1', 'h1')).toBeNull();
    expect(store.getState().finished).toBe(true);
  });

  it('a 400 while gen still has the job in review is a real failure', async () => {
    gen.saveCorrections!.mockRejectedValueOnce(new ApiError(400, 'bad'));
    renderReview(finish(), cleanFixture());
    await act(async () => fireEvent.press(submitButton()));
    expect(gen.getJob).toHaveBeenCalledWith('j1');
    expect(screen.getByTestId('review-finish-error')).toHaveTextContent(/^We couldn't start your video/);
  });

  it('an unreadable response is a server error, not a connection problem', async () => {
    gen.getCorrectionData!.mockRejectedValueOnce(new ApiError(0, 'invalid_response'));
    renderReview(finish(), cleanFixture());
    await act(async () => fireEvent.press(submitButton()));
    expect(screen.getByTestId('review-finish-error')).toHaveTextContent(/^We couldn't start your video/);
  });

  it('while saving the choice is locked', async () => {
    gen.saveCorrections!.mockReturnValue(new Promise(() => {}));
    renderReview(finish({ stems: readyStems() }), cleanFixture());
    fireEvent.press(submitButton());
    expect(screen.getByTestId('review-choice-clean').props.accessibilityState.disabled).toBe(true);
  });

  it('a ready preview is scrolled into view', async () => {
    gen.requestPreview!.mockResolvedValue({ status: 'success', previewHash: 'abc' });
    renderReview(finish(), cleanFixture());
    const scroll = screen.getByTestId('review-finish-scroll');
    const scrollToEnd = jest.fn();
    // The host ScrollView's instance method, reached through the ref FinishStep holds.
    jest.spyOn(ScrollView.prototype, 'scrollToEnd').mockImplementation(scrollToEnd);
    await act(async () => fireEvent.press(screen.getByTestId('review-preview-start')));
    expect(scrollToEnd).toHaveBeenCalled();
    fireEvent(scroll, 'contentSizeChange', 400, 1200);
    expect(scrollToEnd).toHaveBeenCalledTimes(2);
  });
});
