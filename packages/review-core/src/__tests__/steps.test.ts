import { planSteps } from '../steps';

describe('planSteps', () => {
  it('lyrics confident: only finish, chooser collapsed when backing confident', () => {
    expect(planSteps({ auto_approval: { lyrics: { confident: true }, backing: { confident: true } } }))
      .toEqual({ steps: ['finish'], showChooser: true, chooserCollapsed: true });
  });
  it('lyrics not confident: both, chooser expanded', () => {
    expect(planSteps({ auto_approval: { lyrics: { confident: false }, backing: { confident: false } } }))
      .toEqual({ steps: ['lyrics', 'finish'], showChooser: true, chooserCollapsed: false });
  });
  it('custom instrumental hides the chooser', () => {
    expect(planSteps({ auto_approval: { custom_instrumental: true, backing: { confident: true } } }))
      .toEqual({ steps: ['lyrics', 'finish'], showChooser: false, chooserCollapsed: false });
  });
  it('absent auto_approval shows both steps', () => {
    expect(planSteps({})).toEqual({ steps: ['lyrics', 'finish'], showChooser: true, chooserCollapsed: false });
  });
});
