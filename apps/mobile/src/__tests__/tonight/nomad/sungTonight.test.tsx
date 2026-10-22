import { fireEvent, screen } from '@testing-library/react-native';

import { SungTonight } from '../../../tonight/nomad/SungTonight';
import { renderTonight, song, by, at } from '../../../test-utils/tonightFixtures';

it('sung collapsed with count', () => {
  // Sung rows can still carry the stale queue estimate and a quick-version state from before they were sung.
  const sung = [
    song({ performed: true, estimate: at(1, 0, true), quick: 'chosen', request: { song_title: 'One' } }),
    song({ performed: true, request: { song_title: 'Two' } }),
  ];
  renderTonight(<SungTonight songs={sung} />);
  expect(screen.getByTestId('tonight-sung-toggle')).toHaveTextContent('✓ Already sung tonight (2)');
  expect(screen.queryByText(by('One'))).toBeNull();
  fireEvent.press(screen.getByTestId('tonight-sung-toggle'));
  expect(screen.getByText(by('One'))).toBeTruthy();
  // Read-only: actions would 409 (A.50).
  expect(screen.queryByTestId(/^tonight-song-(cancel|change)-/)).toBeNull();
  // They read as sung, never as a live-queue status or a quick-version note.
  for (const s of sung) expect(screen.getByTestId(`tonight-song-status-r${s.request.id}`)).toHaveTextContent('✓ Sung tonight');
  expect(screen.queryByText(/quick version/)).toBeNull();
  expect(screen.queryByText("You're up. Head to the stage!")).toBeNull();
});

it('renders nothing when nothing has been sung', () => {
  renderTonight(<SungTonight songs={[]} />);
  expect(screen.queryByTestId('tonight-sung')).toBeNull();
});
