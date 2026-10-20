import { IntlProvider } from '@nomad/i18n';
import { collectIssues, fromCorrectionData } from '@nomad/review-core';
import { render, screen } from '@testing-library/react-native';
import { I18nManager } from 'react-native';

import { directionalIcon } from '../../review/directionalIcon';
import { IssuesBar } from '../../review/lyrics/IssuesBar';
import { correctionsFixture } from '../../test-utils/reviewFixtures';

describe('directionalIcon', () => {
  it('keeps icons as they are left to right', () => {
    expect(directionalIcon('arrow-forward', false)).toBe('arrow-forward');
    expect(directionalIcon('chevron-back', false)).toBe('chevron-back');
    expect(directionalIcon('arrow-undo', false)).toBe('arrow-undo');
  });

  it('mirrors arrows, chevrons and undo right to left', () => {
    expect(directionalIcon('arrow-forward', true)).toBe('arrow-back');
    expect(directionalIcon('arrow-back', true)).toBe('arrow-forward');
    expect(directionalIcon('chevron-forward', true)).toBe('chevron-back');
    expect(directionalIcon('chevron-back', true)).toBe('chevron-forward');
    expect(directionalIcon('arrow-undo', true)).toBe('arrow-redo');
  });

  it('leaves icons with no direction alone', () => {
    expect(directionalIcon('play', true)).toBe('play');
    expect(directionalIcon('play-back', true)).toBe('play-back');
  });

  it('defaults to the app layout direction', () => {
    const restore = jest.replaceProperty(I18nManager, 'isRTL', true);
    expect(directionalIcon('arrow-forward')).toBe('arrow-back');
    restore.restore();
  });
});

describe('IssuesBar in RTL', () => {
  it('points "next" toward the end of an RTL row (left)', () => {
    const restore = jest.replaceProperty(I18nManager, 'isRTL', true);
    render(
      <IntlProvider locale="he">
        <IssuesBar issues={collectIssues(fromCorrectionData(correctionsFixture()))} cursor={-1} onStep={jest.fn()} />
      </IntlProvider>,
    );
    const icon = (id: string) => screen.getByTestId(id).findAll((n) => typeof n.props.name === 'string')[0]?.props.name;
    expect(icon('review-issues-next')).toBe('chevron-back');
    expect(icon('review-issues-prev')).toBe('chevron-forward');
    restore.restore();
  });
});
