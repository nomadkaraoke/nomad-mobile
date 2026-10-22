import { screen } from '@testing-library/react-native';

import { StageTile, StatusTile } from '../../../tonight/nomad/StatusTile';
import { at, me, nowResult, renderTonight, song, by, iso } from '../../../test-utils/tonightFixtures';

const withNext = (position: number, etaS: number) => {
  const s = song({ request: { song_title: 'Starlight', song_artist: 'Muse', linked_entry_id: 42 }, estimate: at(position, etaS) });
  return me({ songs: [s], next: { entry_id: 42, position, eta_s: etaS, range_low_s: 0, range_high_s: etaS + 300 } });
};

describe('StatusTile', () => {
  it('status tile urgent at <=3', () => {
    const { rerender } = renderTonight(<StatusTile me={withNext(3, 600)} now={nowResult()} />);
    expect(screen.getByTestId('tonight-status-urgent')).toBeTruthy();
    expect(screen.getByTestId('tonight-status-song')).toHaveTextContent(by('Starlight'));

    rerender(<StatusTile me={withNext(4, 5280)} now={nowResult()} />);
    expect(screen.queryByTestId('tonight-status-urgent')).toBeNull();
    // Waits read "1h 28m" (A.47).
    expect(screen.getByTestId('tonight-status-summary')).toHaveTextContent('#4 in line · about 1h 28m');
  });

  it('is urgent and says so when the singer is on stage', () => {
    const s = song({ estimate: at(1, 0, true) });
    renderTonight(<StatusTile me={me({ songs: [s] })} />);
    expect(screen.getByTestId('tonight-status-urgent')).toBeTruthy();
    expect(screen.getByTestId('tonight-status-summary')).toHaveTextContent("You're up. Head to the stage!");
  });

  it('reads "right after this song" at position 2 while someone is singing, else "almost up"', () => {
    const { rerender } = renderTonight(<StatusTile me={withNext(2, 200)} now={nowResult()} />);
    expect(screen.getByTestId('tonight-status-summary')).toHaveTextContent("You're next, right after this song.");
    rerender(<StatusTile me={withNext(2, 200)} now={nowResult({ now_singing: null })} />);
    expect(screen.getByTestId('tonight-status-summary')).toHaveTextContent('Almost up: 1 song to go.');
  });

  it('names the next song (of N) and never counts a friend song as the next turn', () => {
    const friend = song({ owner: 'friend', request: { song_title: 'Friend Song', singer_name: 'Alex' }, estimate: at(2) });
    const mine = song({ request: { song_title: 'Mine', linked_entry_id: 77 }, estimate: at(5, 1200) });
    const other = song({ request: { song_title: 'Later' }, estimate: at(9) });
    renderTonight(
      <StatusTile me={me({ songs: [friend, mine, other], next: { entry_id: 77, position: 5, eta_s: 1200, range_low_s: 0, range_high_s: 1500 } })} />,
    );
    expect(screen.getByTestId('tonight-status-song')).toHaveTextContent(by('Mine'));
    expect(screen.getByText('Your next song (of 2)')).toBeTruthy();
    expect(screen.getByTestId('tonight-status-summary')).toHaveTextContent('#5 in line · about 20 min');
  });

  it('shows "waiting for the host" for a pending song with no place yet, and nothing without live songs', () => {
    const { rerender } = renderTonight(<StatusTile me={me({ songs: [song({ request: { status: 'pending', linked_entry_id: null } })] })} />);
    expect(screen.getByTestId('tonight-status-summary')).toHaveTextContent('Waiting for the host…');
    rerender(<StatusTile me={me({ songs: [song({ removed: true })] })} />);
    expect(screen.queryByTestId('tonight-status-tile')).toBeNull();
  });
});

describe('StageTile', () => {
  it('shows who is on stage and up next', () => {
    renderTonight(<StageTile now={nowResult()} />);
    expect(screen.getByTestId('tonight-stage-now')).toHaveTextContent(iso('Ana'));
    expect(screen.getByTestId('tonight-stage-next')).toHaveTextContent(`Up next: ${iso('Ben')}`);
  });
});
