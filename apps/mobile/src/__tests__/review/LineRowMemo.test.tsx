import { act } from '@testing-library/react-native';

import type { ReviewPlayer } from '../../review/audio/useReviewPlayer';
import { LyricsStep } from '../../review/lyrics/LyricsStep';
import { cleanFixture, fakePlayer, renderReview } from '../../test-utils/reviewFixtures';

jest.mock('../../review/audio/useReviewPlayer', () => ({}));

// Count renders of every row through the real component (same memo, same props).
const mockRenders = jest.fn();
jest.mock('../../review/lyrics/LineRow', () => {
  const actual = jest.requireActual('../../review/lyrics/LineRow');
  const React = jest.requireActual('react');
  const inner = actual.LineRow.type;
  return {
    ...actual,
    LineRow: React.memo(function CountedLineRow(props: { index: number }) {
      mockRenders(props.index);
      return inner(props);
    }),
  };
});

it('only the active row re-renders as the playhead moves', () => {
  const player = fakePlayer({ playing: true, position: 10.1 });
  const cb = { onEditLine: jest.fn(), onResync: jest.fn(), onNudge: jest.fn(), onWordPress: jest.fn(), onRequestText: jest.fn(), onNext: jest.fn() };
  const ui = (p: typeof player) => <LyricsStep player={p as unknown as ReviewPlayer} peaks={{ status: 'ready', peaks: [], duration: 60 }} vocalsReady {...cb} />;
  const r = renderReview(ui(player), cleanFixture());
  mockRenders.mockClear();
  act(() => r.rerenderUi(ui({ ...player, position: 10.3 })));
  act(() => r.rerenderUi(ui({ ...player, position: 10.7 })));
  const rendered = mockRenders.mock.calls.map(([i]) => i);
  expect(rendered.length).toBeGreaterThan(0);
  expect(new Set(rendered)).toEqual(new Set([0]));
});
