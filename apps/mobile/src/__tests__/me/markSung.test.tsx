// markSung: the Mark as sung sheet (Phase 4a, B10).
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { MarkSungSheet } from '../../me/MarkSungSheet';
import { useNightStore } from '../../tonight/nightStore';
import { useLogStore } from '../../tonight/log/logStore';
import { useOutbox } from '../../tonight/log/outbox';
import { renderTonight } from '../../test-utils/tonightFixtures';
import { resetMe } from './helpers';

const SONG = { artist: 'Invented Band', title: 'Made Up Song', song_key: 'sk_1' };
const entries = () => Object.values(useLogStore.getState().entries);
const queued = () => useOutbox.getState().items;

beforeEach(() => {
  resetMe();
});

describe('markSung', () => {
  it('"A while ago" x3 backfills with times 3 and precision unknown', () => {
    const onClose = jest.fn();
    renderTonight(<MarkSungSheet song={SONG} onClose={onClose} />);
    fireEvent.press(screen.getByTestId('mark-when-ago'));
    fireEvent.press(screen.getByTestId('mark-times-plus'));
    fireEvent.press(screen.getByTestId('mark-times-plus'));
    expect(screen.getByTestId('mark-times-value')).toHaveTextContent('3');
    fireEvent.press(screen.getByTestId('mark-save'));

    const [e] = entries();
    expect(entries()).toHaveLength(1);
    expect(e).toMatchObject({ state: 'sung', times: 3, origin: 'backfill', song_key: 'sk_1', night: { kind: 'other', date_precision: 'unknown' } });
    expect(e!.night!.date).toBeUndefined();
    expect((queued()[0] as { patch: unknown }).patch).toMatchObject({ times: 3, origin: 'backfill' });
    expect(onClose).toHaveBeenCalled();
  });

  it('the stepper stays within 1-50', () => {
    renderTonight(<MarkSungSheet song={SONG} onClose={jest.fn()} />);
    fireEvent.press(screen.getByTestId('mark-when-ago'));
    fireEvent.press(screen.getByTestId('mark-times-minus'));
    expect(screen.getByTestId('mark-times-value')).toHaveTextContent('1');
    for (let i = 0; i < 60; i++) fireEvent.press(screen.getByTestId('mark-times-plus'));
    expect(screen.getByTestId('mark-times-value')).toHaveTextContent('50');
  });

  it('a month and year gives month precision; a day upgrades it to day', () => {
    renderTonight(<MarkSungSheet song={SONG} onClose={jest.fn()} />);
    fireEvent.press(screen.getByTestId('mark-when-date'));
    fireEvent.press(screen.getByTestId('mark-year-2020'));
    fireEvent.press(screen.getByTestId('mark-month-3'));
    fireEvent.press(screen.getByTestId('mark-save'));
    expect(entries()[0]!.night).toMatchObject({ date: '2020-03', date_precision: 'month' });
    expect(entries()[0]!.times).toBe(1);
  });

  it('an optional day gives day precision', () => {
    renderTonight(<MarkSungSheet song={SONG} onClose={jest.fn()} />);
    fireEvent.press(screen.getByTestId('mark-when-date'));
    fireEvent.press(screen.getByTestId('mark-year-2020'));
    fireEvent.press(screen.getByTestId('mark-month-3'));
    fireEvent.press(screen.getByTestId('mark-day-plus'));
    fireEvent.press(screen.getByTestId('mark-day-plus'));
    fireEvent.press(screen.getByTestId('mark-save'));
    expect(entries()[0]!.night).toMatchObject({ date: '2020-03-02', date_precision: 'day' });
  });

  it('Tonight joins the open other-bar night through addOther', () => {
    const addOther = jest.spyOn(useLogStore.getState(), 'addOther');
    useNightStore.getState().startOther('The Test Bar');
    renderTonight(<MarkSungSheet song={SONG} onClose={jest.fn()} />);
    fireEvent.press(screen.getByTestId('mark-when-tonight'));
    expect(screen.queryByTestId('mark-times-value')).toBeNull();
    fireEvent.press(screen.getByTestId('mark-save'));
    expect(addOther).toHaveBeenCalledWith(expect.objectContaining({ title: 'Made Up Song' }), 'sung');
    expect(entries()[0]).toMatchObject({ state: 'sung' });
    expect(entries()[0]!.origin).toBeUndefined();
    addOther.mockRestore();
  });

  it('offers the survey from the sheet dismissal, not while it is closing', () => {
    renderTonight(<MarkSungSheet song={SONG} onClose={jest.fn()} />);
    fireEvent.press(screen.getByTestId('mark-when-ago'));
    fireEvent.press(screen.getByTestId('mark-save'));
    expect(screen.queryByTestId('survey')).toBeNull();
    const modal = screen.UNSAFE_getAllByType(Modal)[0]!;
    act(() => modal.props.onDismiss());
    expect(screen.getByTestId('survey')).toBeTruthy();
  });
});
