import { fireEvent, screen } from '@testing-library/react-native';

import { YourSongs } from '../../../tonight/nomad/YourSongs';
import { at, renderTonight, song, by, iso } from '../../../test-utils/tonightFixtures';

it('your songs ordered by position', () => {
  // Submitted in a different order than the queue (Auto Order moved them): the list follows the queue (A.49).
  const third = song({ request: { song_title: 'Third', created_at: '2026-10-21T19:00:00Z' }, estimate: at(9) });
  const first = song({ request: { song_title: 'First', created_at: '2026-10-21T21:00:00Z' }, estimate: at(2) });
  const second = song({ request: { song_title: 'Second', created_at: '2026-10-21T20:00:00Z' }, estimate: at(5) });
  renderTonight(<YourSongs songs={[first, second, third]} />);
  const titles = screen.getAllByTestId(/^tonight-song-title-/).map((n) => n.props.children);
  expect(titles).toEqual([by('First'), by('Second'), by('Third')]);
});

it('host-added and partner rows labelled', () => {
  const host = song({ owner: 'host', entry_id: 900, added_by_host: true, request: { id: null, source_type: 'rotation', song_title: 'Hello - Adele', song_artist: '' } });
  const partner = song({ owner: 'partner', entry_id: 901, added_by: 'Jasmine', request: { id: null, source_type: 'rotation', song_title: 'Shallow - Lady Gaga', song_artist: '' } });
  const friend = song({ owner: 'friend', request: { singer_name: 'Alex', for_friend: true } });
  renderTonight(<YourSongs songs={[host, partner, friend]} />);
  expect(screen.getByTestId('tonight-song-owner-e900')).toHaveTextContent('Added by the host');
  expect(screen.getByTestId('tonight-song-owner-e901')).toHaveTextContent(`Added by ${iso('Jasmine')}`);
  expect(screen.getByTestId(`tonight-song-owner-r${friend.request.id}`)).toHaveTextContent(`For ${iso('Alex')}`);
  // Host and partner rows have no request id: no cancel or change (reorder only, A.3).
  expect(screen.queryByTestId('tonight-song-cancel-e900')).toBeNull();
  expect(screen.queryByTestId('tonight-song-change-e901')).toBeNull();
  expect(screen.getByTestId(`tonight-song-cancel-r${friend.request.id}`)).toBeTruthy();
});

it('duet partners are listed through a localised message', () => {
  const two = song({ request: { additional_singers: [{ name: 'Ana' }, { name: 'Ben' }] } });
  const three = song({ request: { additional_singers: [{ name: 'Ana' }, { name: 'Ben' }, { name: 'Cy' }] } });
  renderTonight(<YourSongs songs={[two, three]} />);
  expect(screen.getByText(`With ${iso('Ana')} and ${iso('Ben')}`)).toBeTruthy();
  expect(screen.getByText(`With ${iso('Ana')}, ${iso('Ben')} and ${iso('Cy')}`)).toBeTruthy();
});

it('host-removed shows honest copy and dismiss', () => {
  const removed = song({ removed: true, request: { song_title: 'Gone' } });
  const onDismiss = jest.fn();
  const onCancel = jest.fn();
  renderTonight(<YourSongs songs={[removed]} onDismiss={onDismiss} onCancel={onCancel} />);
  const key = `r${removed.request.id}`;
  expect(screen.getByTestId(`tonight-song-status-${key}`)).toHaveTextContent(
    "The host took this song off the list. Ask them if that's a surprise.",
  );
  expect(screen.queryByTestId(`tonight-song-cancel-${key}`)).toBeNull();
  fireEvent.press(screen.getByTestId(`tonight-song-dismiss-${key}`));
  expect(onDismiss).toHaveBeenCalledWith(removed);
});

describe('row actions (ruling E4-R4: placeholders wired by E5–E7, shown only where the spec applies)', () => {
  it('own queued song: change, cancel, preview call their props', () => {
    const s = song({ previewable: true, estimate: at(4) });
    const props = { onCancel: jest.fn(), onChange: jest.fn(), onPreview: jest.fn() };
    renderTonight(<YourSongs songs={[s]} {...props} />);
    const key = `r${s.request.id}`;
    fireEvent.press(screen.getByTestId(`tonight-song-cancel-${key}`));
    fireEvent.press(screen.getByTestId(`tonight-song-change-${key}`));
    fireEvent.press(screen.getByTestId(`tonight-song-preview-${key}`));
    expect(props.onCancel).toHaveBeenCalledWith(s);
    expect(props.onChange).toHaveBeenCalledWith(s);
    expect(props.onPreview).toHaveBeenCalledWith(s);
  });

  it('no change or cancel while on stage', () => {
    const s = song({ estimate: at(1, 0, true) });
    renderTonight(<YourSongs songs={[s]} />);
    expect(screen.queryByTestId(`tonight-song-cancel-r${s.request.id}`)).toBeNull();
    expect(screen.queryByTestId(`tonight-song-change-r${s.request.id}`)).toBeNull();
  });

  it('make-it in review offers "Review it now"; a quick version offers preview and sing it now', () => {
    const review = song({ make: 'review', request: { source_type: 'make' } });
    const quick = song({ make: 'making', quick: 'ready', request: { source_type: 'make' } });
    const props = { onReview: jest.fn(), onQuickPreview: jest.fn(), onSingQuick: jest.fn() };
    renderTonight(<YourSongs songs={[review, quick]} {...props} />);
    fireEvent.press(screen.getByTestId(`tonight-song-review-r${review.request.id}`));
    fireEvent.press(screen.getByTestId(`tonight-song-quick-preview-r${quick.request.id}`));
    fireEvent.press(screen.getByTestId(`tonight-song-quick-sing-r${quick.request.id}`));
    expect(props.onReview).toHaveBeenCalledWith(review);
    expect(props.onQuickPreview).toHaveBeenCalledWith(quick);
    expect(props.onSingQuick).toHaveBeenCalledWith(quick);
    // Not changeable while being made.
    expect(screen.queryByTestId(`tonight-song-change-r${review.request.id}`)).toBeNull();
    expect(screen.getByTestId(`tonight-song-status-r${review.request.id}`)).toHaveTextContent(/lyrics sync review/);
  });

  it('read-only (box unreachable): no actions at all', () => {
    const s = song({ previewable: true, estimate: at(4) });
    renderTonight(<YourSongs songs={[s, song()]} readOnly />);
    expect(screen.queryByTestId(/^tonight-song-(cancel|change|preview)-/)).toBeNull();
    expect(screen.queryByTestId('tonight-request')).toBeNull();
    expect(screen.queryByTestId('tonight-reorder')).toBeNull();
  });

  it('request and reorder buttons call their props (reorder only with two or more songs)', () => {
    const onRequest = jest.fn();
    const onReorder = jest.fn();
    const { rerender } = renderTonight(<YourSongs songs={[song()]} onRequest={onRequest} onReorder={onReorder} />);
    expect(screen.queryByTestId('tonight-reorder')).toBeNull();
    fireEvent.press(screen.getByTestId('tonight-request'));
    expect(onRequest).toHaveBeenCalled();
    rerender(<YourSongs songs={[song(), song()]} onRequest={onRequest} onReorder={onReorder} />);
    fireEvent.press(screen.getByTestId('tonight-reorder'));
    expect(onReorder).toHaveBeenCalled();
  });
});
