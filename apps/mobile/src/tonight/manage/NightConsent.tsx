import { getNight, type MeResult, type Night } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Text, TextField } from '@nomad/ui';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { appStorage } from '../../storage';
import type { NomadNight } from '../nightStore';
import { nightKey } from '../nomad/queries';

/** The singer's night-wide photo/clip answer and optional Instagram handle, per account and night (ruling E6-R8). */
export type NightConsent = { consent?: 'yes' | 'no'; instagram?: string };

/** Instagram's own limit and charset: leading @s and whitespace stripped, only [A-Za-z0-9._], at most 30. */
export function sanitizeInstagram(raw: string | null | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^[@\s]+/, '')
    .replace(/[^A-Za-z0-9._]/g, '')
    .slice(0, 30);
}

const key = (userKey: string | null, nightId: string) => `tonight.consent.v1.${userKey ?? 'anon'}.${nightId}`;

export function loadNightConsent(userKey: string | null, nightId: string): NightConsent {
  try {
    const v = JSON.parse(appStorage.getString(key(userKey, nightId)) ?? '{}') as Record<string, unknown>;
    return {
      ...(v.consent === 'yes' || v.consent === 'no' ? { consent: v.consent } : {}),
      ...(typeof v.instagram === 'string' && sanitizeInstagram(v.instagram) ? { instagram: sanitizeInstagram(v.instagram) } : {}),
    };
  } catch {
    return {};
  }
}

export function saveNightConsent(userKey: string | null, nightId: string, value: NightConsent): void {
  try {
    const instagram = sanitizeInstagram(value.instagram);
    appStorage.set(key(userKey, nightId), JSON.stringify({ ...(value.consent ? { consent: value.consent } : {}), ...(instagram ? { instagram } : {}) }));
  } catch {
    // best effort: the question is asked again next time
  }
}

/**
 * The submit fields for an own request: nothing while unknown (A.91), the handle only with a yes. The box's own
 * night-wide answer (`/me` photo_consent), when it knows one, is the truth: a "Nothing from tonight" or an answer
 * given elsewhere wins over this device's stored one, so a request never opts the singer back in.
 */
export function consentFields(c: NightConsent, server?: 'yes' | 'no' | null): { photo_consent?: 'yes' | 'no'; instagram?: string } {
  const consent = server === 'yes' || server === 'no' ? server : c.consent;
  if (!consent) return {};
  const handle = c.consent === 'yes' ? sanitizeInstagram(c.instagram) : '';
  return { photo_consent: consent, ...(consent === 'yes' && handle ? { instagram: handle } : {}) };
}

/** The night-wide answer in the cached `/me` read (null when the box has none, undefined before the first read). */
export function serverNightConsent(queryClient: QueryClient, night: NomadNight, userKey: string | null): 'yes' | 'no' | null | undefined {
  return queryClient.getQueryData<MeResult>([...nightKey(night, userKey), 'me'])?.me.photo_consent;
}

/** After "Nothing from tonight": this device's answer and the cached `/me` both say no, and the handle is dropped. */
export function recordNightOptOut(queryClient: QueryClient, night: NomadNight, userKey: string | null): void {
  saveNightConsent(userKey, night.nightId, { consent: 'no' });
  queryClient.setQueryData<MeResult>([...nightKey(night, userKey), 'me'], (old) =>
    old ? { ...old, me: { ...old.me, photo_consent: 'no', instagram: null } } : old,
  );
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
