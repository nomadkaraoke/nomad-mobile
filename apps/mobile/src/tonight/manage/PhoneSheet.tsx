import { KjboxError, updateMe } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Button, Text, TextField } from '@nomad/ui';
import { getLocales } from 'expo-localization';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { create } from 'zustand';

import { appStorage } from '../../storage';
import { useNightStore, type NomadNight } from '../nightStore';
import { TonightSheet } from '../TonightSheet';
import { useInvalidateNight } from './SongActions';

/** kjbox's own check (sing.py `_PHONE_RE`): a 400 invalid otherwise. */
export const PHONE_RE = /^\+?[0-9 \-()]{7,20}$/;

/** A made-up number in the region's usual format (A.114). Reserved/fictional ranges where a country has one. */
const EXAMPLES: Record<string, string> = {
  US: '(555) 123-4567',
  CA: '(555) 123-4567',
  GB: '07700 900123',
  IE: '085 123 4567',
  AU: '0412 345 678',
  NZ: '021 123 4567',
  DE: '0151 23456789',
  FR: '06 12 34 56 78',
  ES: '612 34 56 78',
  IT: '312 345 6789',
  NL: '06 12345678',
  MX: '55 1234 5678',
  BR: '(11) 91234-5678',
  IN: '91234 56789',
  JP: '090-1234-5678',
};

/** The example for the device's region (expo-localization), falling back to the US format. */
export function phoneExample(region: string | null | undefined = getLocales()[0]?.regionCode): string {
  return EXAMPLES[(region ?? '').toUpperCase()] ?? EXAMPLES.US!;
}

const phoneKey = (userKey: string | null) => `tonight.phone.v1.${userKey ?? 'anon'}`;

function readStored(userKey: string | null): string | null {
  try {
    return appStorage.getString(phoneKey(userKey)) || null;
  } catch {
    return null;
  }
}

/**
 * The singer's "text me when I'm up" number, kept on the phone per account (ruling E6-R5): kjbox only stores a phone
 * on requests, so with no songs yet the app sends it with the next POST /requests instead.
 */
export const usePhoneStore = create<{ phones: Record<string, string | null>; set(userKey: string | null, phone: string): void }>((set) => ({
  phones: {},
  set(userKey, phone) {
    const k = phoneKey(userKey);
    const v = phone.trim();
    appStorage.set(k, v);
    set((s) => ({ phones: { ...s.phones, [k]: v || null } }));
  },
}));

/** The stored phone for this account (null when none). */
export function storedPhone(userKey: string | null): string | null {
  const v = usePhoneStore.getState().phones[phoneKey(userKey)];
  return v !== undefined ? v : readStored(userKey);
}

/** The stored phone for this account, reactive. */
export function useStoredPhone(userKey: string | null): string | null {
  const v = usePhoneStore((s) => s.phones[phoneKey(userKey)]);
  return v !== undefined ? v : readStored(userKey);
}

export type PhoneSheetProps = {
  visible: boolean;
  night: NomadNight;
  userKey: string | null;
  /** The singer has songs of their own tonight: PUT /me writes the number onto them now. */
  hasOwnSongs: boolean;
  onClose: () => void;
};

/**
 * "Text me when I'm up" (spec §4.1 Phone / SMS, A.80, A.114): optional, can be added later, with an example in the
 * region's format. Saved on the phone, and through PUT /me when the singer already has songs.
 */
export function PhoneSheet({ visible, night, userKey, hasOwnSongs, onClose }: PhoneSheetProps) {
  const t = useTranslations('tonight.manage.phone');
  const tManage = useTranslations('tonight.manage');
  const invalidate = useInvalidateNight(night, userKey);
  const [phone, setPhone] = useState(() => storedPhone(userKey) ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setPhone(storedPhone(userKey) ?? '');
      setError(null);
    }
  }

  const save = async () => {
    if (inFlight.current) return;
    const value = phone.trim();
    if (!PHONE_RE.test(value)) {
      setError(t('invalid'));
      return;
    }
    if (!hasOwnSongs) {
      // Kept here and sent with the next request (kjbox stores a phone only on requests).
      usePhoneStore.getState().set(userKey, value);
      onClose();
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await updateMe(night.code, { phone: value, night_id: night.nightId });
      // Only once the box has it: a failed save must not read as "We'll text you".
      usePhoneStore.getState().set(userKey, value);
      invalidate();
      onClose();
    } catch (e) {
      if (e instanceof KjboxError && e.code === 'night_changed') {
        useNightStore.getState().end();
        onClose();
        return;
      }
      setError(e instanceof KjboxError && e.code === 'invalid' ? t('invalid') : t('notSaved'));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <TonightSheet visible={visible} onClose={onClose} title={t('title')} testID="tonight-phone-sheet" closeLabel={tManage('close')}>
      <View className="gap-3 pb-2">
        <Text variant="muted">{t('hint')}</Text>
        <TextField
          testID="tonight-phone-input"
          label={t('label')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          placeholder={phoneExample()}
        />
        <Text testID="tonight-phone-example" variant="muted">
          {t('example', { example: phoneExample() })}
        </Text>
        {error ? (
          <Text testID="tonight-phone-error" variant="error">
            {error}
          </Text>
        ) : null}
        <Button testID="tonight-phone-save" label={t('save')} loading={saving} onPress={() => void save()} />
      </View>
    </TonightSheet>
  );
}
