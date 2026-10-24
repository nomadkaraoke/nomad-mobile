// FitBadge (Phase 3c): the copy for each fit bucket, the octave variants, and nothing for `outside`.
import { IntlProvider } from '@nomad/i18n';
import { render, screen } from '@testing-library/react-native';

import { FitBadge, type BadgeFit } from '../voice/FitBadge';

const show = (fit: BadgeFit | null) =>
  render(
    <IntlProvider locale="en">
      <FitBadge fit={fit} testID="fit-badge-x" />
    </IntlProvider>,
  );

describe('FitBadge', () => {
  it.each<[BadgeFit, string]>([
    [{ bucket: 'fits', transpose: 0, octave: 0 }, 'Fits your voice'],
    [{ bucket: 'fitsIn', transpose: -2, octave: 0 }, 'Try it 2 keys down'],
    [{ bucket: 'fitsIn', transpose: -1, octave: 0 }, 'Try it 1 key down'],
    [{ bucket: 'fitsIn', transpose: 3, octave: 0 }, 'Try it 3 keys up'],
    [{ bucket: 'fitsIn', transpose: 0, octave: -12 }, 'Fits an octave down'],
    [{ bucket: 'fitsIn', transpose: 0, octave: 12 }, 'Fits an octave up'],
    [{ bucket: 'fitsIn', transpose: 2, octave: -12 }, 'An octave down, 2 keys up'],
    [{ bucket: 'fitsIn', transpose: -1, octave: -12 }, 'An octave down, 1 key down'],
    [{ bucket: 'fitsIn', transpose: -3, octave: 12 }, 'An octave up, 3 keys down'],
    [{ bucket: 'fitsIn', transpose: 4, octave: 12 }, 'An octave up, 4 keys up'],
    [{ bucket: 'fits', transpose: 0, octave: -12 }, 'Fits your voice'], // octave-free notes song
    [{ bucket: 'stretch', transpose: 1, octave: 0 }, 'A stretch'],
  ])('%j -> %s', (fit, copy) => {
    show(fit);
    expect(screen.getByTestId('fit-badge-x')).toHaveTextContent(copy);
  });

  it('outside, or no fit at all, renders nothing', () => {
    show({ bucket: 'outside', transpose: 4, octave: 0 });
    expect(screen.queryByTestId('fit-badge-x')).toBeNull();
    show(null);
    expect(screen.queryByTestId('fit-badge-x')).toBeNull();
  });
});
