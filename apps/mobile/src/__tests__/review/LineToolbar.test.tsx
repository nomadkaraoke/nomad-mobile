import { IntlProvider } from '@nomad/i18n';
import { render, screen } from '@testing-library/react-native';

import { LineToolbar, toolbarLabel } from '../../review/lyrics/LineToolbar';

describe('LineToolbar labels', () => {
  it('take two centred lines when long (one for a single word) and shrink to fit, so long labels (he, de, ru) never run together', () => {
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
      // The column's full width, so shrink-to-fit measures against the column.
      expect(label.props.className).toContain('self-stretch');
    }
    expect(screen.getByTestId('review-tool-resync-label').props.children).toBe('Neu\nsynchronisieren');
    // A one-word label gets one line, so a word too wide for its column ("Verschieben") shrinks instead of
    // breaking mid-word onto a second line.
    for (const tool of ['nudge', 'more']) {
      const label = screen.getByTestId(`review-tool-${tool}-label`);
      expect(label.props.numberOfLines).toBe(1);
      expect(label.props.adjustsFontSizeToFit).toBe(true);
    }
  });
});

describe('toolbarLabel', () => {
  it('keeps one word, or a short label, on one line', () => {
    expect(toolbarLabel('Verschieben')).toEqual({ text: 'Verschieben', lines: 1 });
    expect(toolbarLabel('Play line')).toEqual({ text: 'Play line', lines: 1 });
  });

  it('breaks a longer label of two or more words at the space nearest the middle', () => {
    expect(toolbarLabel('השמעת שורה')).toEqual({ text: 'השמעת\nשורה', lines: 2 });
    expect(toolbarLabel('Modifier le texte')).toEqual({ text: 'Modifier\nle texte', lines: 2 });
    expect(toolbarLabel('Zeile abspielen')).toEqual({ text: 'Zeile\nabspielen', lines: 2 });
  });
});
