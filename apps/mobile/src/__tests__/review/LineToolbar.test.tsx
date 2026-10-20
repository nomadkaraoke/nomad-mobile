import { IntlProvider } from '@nomad/i18n';
import { render, screen } from '@testing-library/react-native';

import { LineToolbar } from '../../review/lyrics/LineToolbar';

describe('LineToolbar labels', () => {
  it('wrap onto two centred lines (one for a single word) and shrink to fit, so long labels (he, de, ru) never run together', () => {
    render(
      <IntlProvider locale="de">
        <LineToolbar index={0} canSplit canMerge onTool={jest.fn()} />
      </IntlProvider>,
    );
    for (const tool of ['play', 'edit', 'resync']) {
      const label = screen.getByTestId(`review-tool-${tool}-label`);
      expect(label.props.numberOfLines).toBe(2);
      expect(label.props.adjustsFontSizeToFit).toBe(true);
      expect(label.props.className).toContain('text-center');
    }
    expect(screen.getByTestId('review-tool-resync-label')).toHaveTextContent('Neu synchronisieren');
    // A one-word label gets one line, so a word too wide for its column ("Verschieben") shrinks instead of
    // breaking mid-word onto a second line.
    for (const tool of ['nudge', 'more']) {
      const label = screen.getByTestId(`review-tool-${tool}-label`);
      expect(label.props.numberOfLines).toBe(1);
      expect(label.props.adjustsFontSizeToFit).toBe(true);
    }
  });
});
