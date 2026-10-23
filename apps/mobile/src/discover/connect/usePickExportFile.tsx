import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useCallback, useState } from 'react';

import { pickExportFile } from './pickExportFile';

/** A pick button's handler, plus whether the last pick failed (the picker itself errored). */
export function usePickExportFile(replace = false): { pick: () => void; failed: boolean } {
  const [failed, setFailed] = useState(false);
  const pick = useCallback(() => {
    setFailed(false);
    void pickExportFile(replace).then((outcome) => setFailed(outcome === 'failed'));
  }, [replace]);
  return { pick, failed };
}

/** Shown under a pick button when the system picker failed to open or to hand back the file. */
export function PickExportError({ visible }: { visible: boolean }) {
  const t = useTranslations('connect');
  if (!visible) return null;
  return (
    <Text testID="connect-pick-error" variant="error" accessibilityLiveRegion="polite">
      {t('errors.generic')}
    </Text>
  );
}
