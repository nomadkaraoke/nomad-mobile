// Re-editing a survey can clear vibes / reasons (decide merges survey sub-fields, so a clear is an explicit []).
import { fireEvent, screen } from '@testing-library/react-native';

import { useLogStore } from '../../tonight/log/logStore';
import { useOutbox } from '../../tonight/log/outbox';
import { SurveySheet } from '../../tonight/log/SurveySheet';
import { renderTonight } from '../../test-utils/tonightFixtures';
import { resetMe } from './helpers';

const queuedPatch = () => (useOutbox.getState().items[0] as { patch: { survey?: Record<string, unknown> } }).patch;

beforeEach(() => {
  resetMe();
  useLogStore.getState().noteNomad('kj_1', { artist: 'Invented Band', title: 'Made Up Song' });
});

it('editing away every vibe sends vibes: [] and clears them locally', () => {
  const initial = { feel: 'great' as const, vibes: ['party' as const, 'duet' as const] };
  useLogStore.getState().saveSurvey('kj_1', initial);
  useOutbox.getState().rehydrate('a@example.com');
  renderTonight(<SurveySheet entryId="kj_1" artist="Invented Band" title="Made Up Song" initial={initial} />);
  fireEvent.press(screen.getByTestId('survey-vibe-party'));
  fireEvent.press(screen.getByTestId('survey-vibe-duet'));
  fireEvent.press(screen.getByTestId('survey-save'));
  expect(queuedPatch().survey).toMatchObject({ feel: 'great', vibes: [] });
  expect(useLogStore.getState().entries['kj_1']!.survey!.vibes).toEqual([]);
});

it('switching bad to great sends reasons: []', () => {
  const initial = { feel: 'bad' as const, reasons: ['too_hard' as const] };
  renderTonight(<SurveySheet entryId="kj_1" artist="Invented Band" title="Made Up Song" initial={initial} />);
  fireEvent.press(screen.getByTestId('survey-feel-great'));
  fireEvent.press(screen.getByTestId('survey-save'));
  expect(queuedPatch().survey).toMatchObject({ feel: 'great', reasons: [] });
  expect(queuedPatch().survey).not.toHaveProperty('vibes');
});

it('a fresh survey (no initial) never sends empty arrays', () => {
  renderTonight(<SurveySheet entryId="kj_1" artist="Invented Band" title="Made Up Song" />);
  fireEvent.press(screen.getByTestId('survey-feel-ok'));
  fireEvent.press(screen.getByTestId('survey-save'));
  expect(queuedPatch().survey).not.toHaveProperty('vibes');
  expect(queuedPatch().survey).not.toHaveProperty('reasons');
});
