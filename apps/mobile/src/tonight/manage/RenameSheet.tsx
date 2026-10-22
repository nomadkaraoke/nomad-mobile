import { KjboxError, updateMe } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text, TextField } from '@nomad/ui';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { useNightStore, type NomadNight } from '../nightStore';
import { errorCopy } from '../request/errorCopy';
import { TonightSheet } from '../TonightSheet';
import { useInvalidateNight } from './SongActions';

type Phase = { kind: 'edit' } | { kind: 'guard'; from: string; to: string } | { kind: 'hostNamed' };

export type RenameSheetProps = {
  visible: boolean;
  night: NomadNight;
  userKey: string | null;
  currentName: string;
  onClose: () => void;
  /** Saved: the night screen shows "✓ Name saved". */
  onSaved?: () => void;
  /** "X is a friend": open the friend flow for that name instead of renaming. */
  onFriend: (name: string) => void;
};

/**
 * Edit your name with the rename guard (spec §4.1 Name, A.6–A.11, ruling E6-R1). PUT /me; a 409 conflict with reason
 * rename_guard asks "Rename yourself to X?" with, in this order: "X is a friend: request a song for them", "Yes, I'm
 * X: rename me" (resent with confirm_rename) and Cancel. host_named only says to ask the host (no rename option).
 * Spelling fixes and renames with no songs go straight through (the box decides).
 */
export function RenameSheet({ visible, night, userKey, currentName, onClose, onSaved, onFriend }: RenameSheetProps) {
  const t = useTranslations('tonight.manage.name');
  const tManage = useTranslations('tonight.manage');
  const tAll = useTranslations();
  const invalidate = useInvalidateNight(night, userKey);
  const [name, setName] = useState(currentName);
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Each opening starts from the current name (state adjusted during render, not in an effect).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setName(currentName);
      setPhase({ kind: 'edit' });
      setError(null);
    }
  }

  const save = async (value: string, confirm: boolean) => {
    if (inFlight.current) return;
    if (!value.trim()) {
      setError(t('required'));
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await updateMe(night.code, { name: value.trim(), night_id: night.nightId, ...(confirm ? { confirm_rename: true } : {}) });
      invalidate();
      onSaved?.();
      onClose();
    } catch (e) {
      if (e instanceof KjboxError && e.code === 'conflict' && e.reason === 'rename_guard') {
        setPhase({ kind: 'guard', from: e.from ?? currentName, to: e.to ?? value.trim() });
      } else if (e instanceof KjboxError && e.code === 'conflict' && e.reason === 'host_named') {
        setPhase({ kind: 'hostNamed' });
      } else if (e instanceof KjboxError && e.code === 'night_changed') {
        useNightStore.getState().end();
        onClose();
      } else {
        const c = errorCopy(e);
        setError(tAll(c.key, c.values));
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <TonightSheet visible={visible} onClose={onClose} title={t('title')} testID="tonight-rename-sheet" closeLabel={tManage('close')}>
      <View className="gap-3 pb-2">
        {phase.kind === 'edit' ? (
          <>
            <TextField
              testID="tonight-rename-input"
              label={t('label')}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              // The sheet is only for this field (UX review): the keyboard comes up with it, cursor after the name.
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void save(name, false)}
            />
            {error ? (
              <Text testID="tonight-rename-error" variant="error">
                {error}
              </Text>
            ) : null}
            <Button testID="tonight-rename-save" label={t('save')} loading={saving} onPress={() => void save(name, false)} />
          </>
        ) : phase.kind === 'guard' ? (
          <View testID="tonight-rename-guard" className="gap-3">
            <Text className="text-lg font-bold">{t('guardQuestion', { name: isolate(phase.to) })}</Text>
            <Text variant="muted">{t('guardHint', { from: isolate(phase.from) })}</Text>
            {error ? (
              <Text testID="tonight-rename-error" variant="error">
                {error}
              </Text>
            ) : null}
            {/* A.11: this order, the friend option first. */}
            <Button
              testID="tonight-rename-guard-friend"
              variant="secondary"
              label={t('friend', { name: isolate(phase.to) })}
              disabled={saving}
              onPress={() => {
                onClose();
                onFriend(phase.to);
              }}
            />
            <Button
              testID="tonight-rename-guard-rename"
              label={t('rename', { name: isolate(phase.to) })}
              loading={saving}
              onPress={() => void save(phase.to, true)}
            />
            <Button testID="tonight-rename-guard-cancel" variant="secondary" label={t('cancel')} disabled={saving} onPress={onClose} />
          </View>
        ) : (
          <View testID="tonight-rename-host-named" className="gap-3">
            <Text>{t('hostNamed')}</Text>
            <Button testID="tonight-rename-host-named-ok" variant="secondary" label={tManage('close')} onPress={onClose} />
          </View>
        )}
      </View>
    </TonightSheet>
  );
}
