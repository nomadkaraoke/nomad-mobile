import { IntlProvider } from '@nomad/i18n';
import { collectIssues, fromCorrectionData, type Issue } from '@nomad/review-core';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { IssuesBar } from '../../review/lyrics/IssuesBar';
import { cleanFixture, correctionsFixture } from '../../test-utils/reviewFixtures';

const issues = collectIssues(fromCorrectionData(correctionsFixture()));

function renderBar(list: Issue[], cursor: number) {
  const onStep = jest.fn();
  render(
    <IntlProvider locale="en">
      <IssuesBar issues={list} cursor={cursor} onStep={onStep} />
    </IntlProvider>,
  );
  return onStep;
}

describe('IssuesBar', () => {
  it('fixture issues are in time order', () => {
    expect(issues.map((i) => [i.kind, i.segment])).toEqual([
      ['ai_corrected', 0],
      ['untimed', 1],
      ['estimated', 2],
      ['vocal_gap', 3],
    ]);
  });

  it('is hidden with nothing to check', () => {
    renderBar(collectIssues(fromCorrectionData(cleanFixture())), -1);
    expect(screen.queryByTestId('review-issues-label')).toBeNull();
  });

  it('counts before stepping, then shows the position and kind', () => {
    const onStep = renderBar(issues, -1);
    expect(screen.getByTestId('review-issues-label')).toHaveTextContent('4 things to check');
    fireEvent.press(screen.getByTestId('review-issues-next'));
    expect(onStep).toHaveBeenLastCalledWith(0);
    fireEvent.press(screen.getByTestId('review-issues-prev'));
    expect(onStep).toHaveBeenLastCalledWith(3);
  });

  it('steps forward and back from the current issue, wrapping', () => {
    const onStep = renderBar(issues, 1);
    expect(screen.getByTestId('review-issues-label')).toHaveTextContent('2 of 4 · Word needs timing');
    fireEvent.press(screen.getByTestId('review-issues-next'));
    expect(onStep).toHaveBeenLastCalledWith(2);
    fireEvent.press(screen.getByTestId('review-issues-prev'));
    expect(onStep).toHaveBeenLastCalledWith(0);
  });

  it('wraps from the last issue to the first', () => {
    const onStep = renderBar(issues, 3);
    fireEvent.press(screen.getByTestId('review-issues-next'));
    expect(onStep).toHaveBeenLastCalledWith(0);
  });

  it('uses the singular for one issue', () => {
    renderBar(issues.slice(0, 1), -1);
    expect(screen.getByTestId('review-issues-label')).toHaveTextContent('1 thing to check');
  });
});
