import { fireEvent, screen } from '@testing-library/react-native';

import { SungTonight } from '../../../tonight/nomad/SungTonight';
import { renderTonight, song, by } from '../../../test-utils/tonightFixtures';

it('sung collapsed with count', () => {
  const sung = [song({ performed: true, request: { song_title: 'One' } }), song({ performed: true, request: { song_title: 'Two' } })];
  renderTonight(<SungTonight songs={sung} />);
  expect(screen.getByTestId('tonight-sung-toggle')).toHaveTextContent('✓ Already sung tonight (2)');
  expect(screen.queryByText(by('One'))).toBeNull();
  fireEvent.press(screen.getByTestId('tonight-sung-toggle'));
  expect(screen.getByText(by('One'))).toBeTruthy();
  // Read-only: actions would 409 (A.50).
  expect(screen.queryByTestId(/^tonight-song-(cancel|change)-/)).toBeNull();
});

it('renders nothing when nothing has been sung', () => {
  renderTonight(<SungTonight songs={[]} />);
  expect(screen.queryByTestId('tonight-sung')).toBeNull();
});
