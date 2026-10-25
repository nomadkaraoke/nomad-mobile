// SongLibraryActions (Phase 4a, B9): Save / Add to setlist / Mark as sung on a song page.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { SongLibraryActions } from '../../me/SongLibraryActions';
import { useMeOutbox } from '../../me/meOutbox';
import { renderTonight } from '../../test-utils/tonightFixtures';
import { resetMe } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getLibrary: jest.fn(async () => ({ notModified: false, etag: 'e', items: [] })),
  listSetlists: jest.fn(async () => []),
  listKaraokeLog: jest.fn(async () => ({ entries: [] })),
}));

const SONG = { artist: 'Invented Band', title: 'Made Up Song', song_key: 'sk_1' };

beforeEach(() => resetMe());

it('Save toggles to Saved and queues a love', () => {
  renderTonight(<SongLibraryActions song={SONG} />);
  expect(screen.getByTestId('song-save')).toHaveTextContent('Save to My songs');
  fireEvent.press(screen.getByTestId('song-save'));
  expect(screen.getByTestId('song-save')).toHaveTextContent('Saved');
  expect(useMeOutbox.getState().items[0]).toMatchObject({ op: 'love', song_key: 'sk_1', loved: true });
});

it('an uncatalogued song has no Save (decide loves by song_key) but keeps the other actions', () => {
  renderTonight(<SongLibraryActions song={{ artist: 'Nobody', title: 'Odd Tune' }} />);
  expect(screen.queryByTestId('song-save')).toBeNull();
  expect(screen.getByTestId('song-add-setlist')).toBeTruthy();
  expect(screen.getByTestId('song-mark-sung')).toBeTruthy();
});

it('Add to setlist and Mark as sung open their sheets', () => {
  renderTonight(<SongLibraryActions song={SONG} />);
  fireEvent.press(screen.getByTestId('song-add-setlist'));
  expect(screen.UNSAFE_getAllByType(Modal).some((m) => m.props.visible && m.props.testID?.includes('setlist'))).toBe(true);
  act(() => fireEvent.press(screen.getByTestId('song-mark-sung')));
  expect(screen.getByTestId('mark-save')).toBeTruthy();
});
