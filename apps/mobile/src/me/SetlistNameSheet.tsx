import { useTranslations } from '@nomad/i18n';
import { Button, Sheet, TextField } from '@nomad/ui';
import { useState } from 'react';
import { View } from 'react-native';

export const MAX_NAME = 100;

/** Name a setlist (new or renamed): 1-100 characters after trimming. */
export function SetlistNameSheet({
  visible,
  initial = '',
  title,
  onSave,
  onClose,
}: {
  visible: boolean;
  initial?: string;
  title: string;
  onSave(name: string): void;
  onClose(): void;
}) {
  const t = useTranslations('me.setlists');
  return (
    <Sheet visible={visible} onClose={onClose} title={title} testID="setlist-name-sheet" closeLabel={t('close')}>
      {/* Mounted only while the sheet is open, so each opening starts from `initial`. */}
      {visible ? <NameForm initial={initial} onSave={onSave} onClose={onClose} /> : null}
    </Sheet>
  );
}

function NameForm({ initial, onSave, onClose }: { initial: string; onSave(name: string): void; onClose(): void }) {
  const t = useTranslations('me.setlists');
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= MAX_NAME;
  const save = () => {
    if (!valid) return;
    onSave(trimmed);
    onClose();
  };
  return (
    <View className="gap-3">
      <TextField
        testID="setlist-name-input"
        label={t('nameLabel')}
        placeholder={t('namePlaceholder')}
        value={name}
        onChangeText={setName}
        maxLength={MAX_NAME}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <Button testID="setlist-name-save" label={t('nameSave')} onPress={save} disabled={!valid} />
    </View>
  );
}
