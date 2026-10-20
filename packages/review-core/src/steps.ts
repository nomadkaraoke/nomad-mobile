import type { CorrectionData } from './types';

export type ReviewStep = 'lyrics' | 'finish';

/**
 * Review step plan (spec 4.1). The Lyrics step is skipped only when the server says it is
 * confident (gen already forces confident=false outside auto mode); a missing auto_approval shows
 * both steps. The chooser is hidden for a custom instrumental and collapses to one line when the
 * backing verdict is confident.
 */
export function planSteps(data: Pick<CorrectionData, 'auto_approval'>): {
  steps: ReviewStep[];
  showChooser: boolean;
  chooserCollapsed: boolean;
} {
  const a = data.auto_approval;
  const showChooser = a?.custom_instrumental !== true;
  return {
    steps: a?.lyrics?.confident === true ? ['finish'] : ['lyrics', 'finish'],
    showChooser,
    chooserCollapsed: showChooser && a?.backing?.confident === true,
  };
}
