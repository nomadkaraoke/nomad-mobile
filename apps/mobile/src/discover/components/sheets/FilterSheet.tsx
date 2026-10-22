import { useTranslations } from '@nomad/i18n';
import { Button, Sheet } from '@nomad/ui';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

export type SheetProps<T> = {
  visible: boolean;
  /** The applied value; the sheet edits a copy until Apply. */
  value: T;
  onApply: (next: T) => void;
  onClose: () => void;
};

/** A draft copy of `value` that is reset to it each time the sheet opens. */
export function useDraft<T>(value: T, visible: boolean) {
  const [draft, setDraft] = useState(value);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setDraft(value);
  }
  return [draft, setDraft] as const;
}

/** The shared frame: `filter-sheet-<name>`, scrolling options, and Clear / Apply (`filter-clear-<name>`, `filter-apply-<name>`). */
export function FilterSheet({
  name,
  title,
  visible,
  onClose,
  onApply,
  onClear,
  children,
}: {
  name: string;
  title: string;
  visible: boolean;
  onClose: () => void;
  onApply: () => void;
  /** Resets the draft (not the applied filters). */
  onClear: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('discover.filter');
  const tc = useTranslations('common');
  return (
    <Sheet visible={visible} onClose={onClose} testID={`filter-sheet-${name}`} title={title} closeLabel={tc('cancel')}>
      <ScrollView className="shrink" keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      <View className="flex-row gap-3 pt-3">
        <View className="flex-1">
          <Button testID={`filter-clear-${name}`} label={t('clear')} variant="secondary" onPress={onClear} />
        </View>
        <View className="flex-1">
          <Button testID={`filter-apply-${name}`} label={t('apply')} onPress={onApply} />
        </View>
      </View>
    </Sheet>
  );
}
