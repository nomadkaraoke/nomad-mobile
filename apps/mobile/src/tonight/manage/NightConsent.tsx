import { getNight, type Night } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Text, TextField } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { appStorage } from '../../storage';
import type { NomadNight } from '../nightStore';
import { nightKey } from '../nomad/queries';

/** The singer's night-wide photo/clip answer and optional Instagram handle, per account and night (ruling E6-R8). */
export type NightConsent = { consent?: 'yes' | 'no'; instagram?: string };

const key = (userKey: string | null, nightId: string) => `tonight.consent.v1.${userKey ?? 'anon'}.${nightId}`;

export function loadNightConsent(userKey: string | null, nightId: string): NightConsent {
  try {
    const v = JSON.parse(appStorage.getString(key(userKey, nightId)) ?? '{}') as Record<string, unknown>;
    return {
      ...(v.consent === 'yes' || v.consent === 'no' ? { consent: v.consent } : {}),
      ...(typeof v.instagram === 'string' && v.instagram ? { instagram: v.instagram } : {}),
    };
  } catch {
    return {};
  }
}

export function saveNightConsent(userKey: string | null, nightId: string, value: NightConsent): void {
  try {
    appStorage.set(key(userKey, nightId), JSON.stringify(value));
  } catch {
    // best effort: the question is asked again next time
  }
}

/** The submit fields for an own request: nothing while unknown (A.91), the handle only with a yes. */
export function consentFields(c: NightConsent): { photo_consent?: 'yes' | 'no'; instagram?: string } {
  if (!c.consent) return {};
  const handle = c.instagram?.trim();
  return { photo_consent: c.consent, ...(c.consent === 'yes' && handle ? { instagram: handle } : {}) };
}

/** GET /night features.ask_photo_consent (shares the night screen's cached /night read). */
export function useAskPhotoConsent(night: NomadNight | null, userKey: string | null): boolean {
  const q = useQuery<Night>({
    queryKey: night ? [...nightKey(night, userKey), 'night'] : ['kjbox', 'none'],
    queryFn: () => getNight(night!.code, night!.nightId),
    enabled: night !== null,
    staleTime: 60_000,
    retry: false,
  });
  return Boolean(q.data?.open && q.data.features.ask_photo_consent);
}

/**
 * The once-per-night question on confirm (spec §4.1 Photo / clip consent, A.92): optional, never blocks the send.
 * A yes offers an optional Instagram handle.
 */
export function NightConsentQuestion({ value, onChange }: { value: NightConsent; onChange: (v: NightConsent) => void }) {
  const t = useTranslations('tonight.manage.nightConsent');
  const pill = (v: 'yes' | 'no', label: string) => {
    const on = value.consent === v;
    return (
      <Pressable
        testID={`tonight-confirm-consent-${v}`}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        onPress={() => onChange({ ...value, consent: v })}
        className={`min-h-11 justify-center rounded-md border px-3 ${on ? 'border-primary bg-primary/10' : 'border-border'}`}
      >
        <Text className="font-semibold">{label}</Text>
      </Pressable>
    );
  };
  return (
    <View testID="tonight-confirm-consent" className="gap-2 rounded-lg border border-border p-3">
      <Text>{t('question')}</Text>
      <Text variant="muted">{t('optional')}</Text>
      <View className="flex-row flex-wrap gap-2">
        {pill('yes', t('yes'))}
        {pill('no', t('no'))}
      </View>
      {value.consent === 'yes' ? (
        <TextField
          testID="tonight-confirm-instagram"
          label={t('instagram')}
          value={value.instagram ?? ''}
          onChangeText={(instagram) => onChange({ ...value, instagram })}
          autoCapitalize="none"
          placeholder={t('instagramPlaceholder')}
        />
      ) : null}
    </View>
  );
}
