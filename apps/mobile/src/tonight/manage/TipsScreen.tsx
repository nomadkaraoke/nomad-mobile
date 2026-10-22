import { claimTip, getTips, KjboxError, type SongRequest, type TipMethod } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Button, colors, Text, TextField } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { appStorage } from '../../storage';
import { useNightStore, type NomadNight } from '../nightStore';
import { nightKey } from '../nomad/queries';
import { errorCopy } from '../request/errorCopy';
import { newRequestId } from '../request/requestStore';

/** The web's amount presets (sing.js renderTip). */
export const TIP_PRESETS = [3, 5, 10, 20];

/** "5" or "5.50" (the copy adds the currency sign). */
export const fmtAmount = (a: number) => (a % 1 === 0 ? String(a) : a.toFixed(2));

/** Amount-first deep link (A.64): Cash App / PayPal.me take /<amount>, Venmo a pay intent; the rest open as they are. */
export function tipUrl(m: TipMethod, amount: number): string | null {
  if (!m.url) return null;
  if (!(amount > 0)) return m.url;
  if (m.amount_style === 'path') return `${m.url}/${fmtAmount(amount)}`;
  if (m.amount_style === 'venmo') return `${m.url}?txn=pay&amount=${fmtAmount(amount)}&note=${encodeURIComponent('Karaoke tip')}`;
  return m.url;
}

/** A tip claim as this phone remembers it (per account and night). */
export type TipClaim = { clientRequestId: string; amount: number; method: string; status: string; id: number | null };

const claimsKey = (userKey: string | null, nightId: string) => `tonight.tips.v1.${userKey ?? 'anon'}.${nightId}`;

function loadClaims(key: string): TipClaim[] {
  try {
    const v: unknown = JSON.parse(appStorage.getString(key) ?? '[]');
    return Array.isArray(v) ? (v as TipClaim[]).filter((c) => c && typeof c.clientRequestId === 'string') : [];
  } catch {
    return [];
  }
}

/** The Tips route: the active Nomad night, else back to Tonight. */
export function TipsRouteScreen() {
  const night = useNightStore((s) => s.active);
  const userKey = useNightStore((s) => s.userKey);
  if (night?.kind !== 'nomad') {
    return <TipsGone />;
  }
  return <TipsScreen night={night} userKey={userKey} />;
}

function TipsGone() {
  const t = useTranslations('tonight.request.confirm');
  return (
    <SafeAreaView testID="tonight-tips" style={{ flex: 1, backgroundColor: colors.bg }} edges={['left', 'right', 'bottom']}>
      <View className="gap-3 p-4">
        <Text testID="tonight-tips-night-ended">{t('nightEnded')}</Text>
        <Button testID="tonight-tips-back" variant="secondary" label={t('backToTonight')} onPress={() => router.dismissTo('/tonight')} />
      </View>
    </SafeAreaView>
  );
}

/**
 * Tip the host (spec §4.1 Tips, A.64, ruling E6-R6): amount first, then a method that opens with the amount filled in
 * (Cash App, Venmo, PayPal; Zelle copies the address; card opens as is). "I sent a tip" files a claim the host
 * confirms; a retry after a timeout reuses the claim's client_request_id, so it never files two.
 */
export function TipsScreen({ night, userKey }: { night: NomadNight; userKey: string | null }) {
  const t = useTranslations('tonight.manage.tips');
  const tAll = useTranslations();
  const tips = useQuery({
    queryKey: [...nightKey(night, userKey), 'tips'],
    queryFn: () => getTips(night.code, night.nightId),
    retry: false,
  });
  const threshold = tips.data?.threshold ?? 0;
  const [preset, setPreset] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const customValue = Number.parseFloat(custom.replace(',', '.'));
  const amount = custom.trim() && customValue > 0 ? customValue : (preset ?? (threshold > 0 ? threshold : 10));

  const [copied, setCopied] = useState<string | null>(null);
  const storageKey = claimsKey(userKey, night.nightId);
  const [claims, setClaims] = useState<TipClaim[]>(() => loadClaims(storageKey));
  const [method, setMethod] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An unknown-outcome claim (timeout, busy_retry): retrying the same amount + method reuses its id.
  const ambiguous = useRef<{ sig: string; id: string } | null>(null);
  const inFlight = useRef(false);

  const open = (m: TipMethod) => {
    const url = tipUrl(m, amount);
    if (url) void Linking.openURL(url);
  };
  const copy = async (m: TipMethod) => {
    if (!m.value) return;
    await Clipboard.setStringAsync(m.value);
    setCopied(m.key);
  };

  const claim = async () => {
    if (inFlight.current) return;
    if (!(amount > 0)) {
      setError(t('amountRequired'));
      return;
    }
    const sig = JSON.stringify([amount, method]);
    const cid = ambiguous.current?.sig === sig ? ambiguous.current.id : newRequestId();
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      const res = await claimTip(night.code, { amount, method: method || null, client_request_id: cid, night_id: night.nightId });
      ambiguous.current = null;
      const req: SongRequest = res.request;
      const next = [
        ...claims.filter((c) => c.clientRequestId !== cid),
        { clientRequestId: cid, amount: req.tip_amount ?? amount, method: req.tip_method ?? method, status: req.status, id: req.id },
      ];
      setClaims(next);
      appStorage.set(storageKey, JSON.stringify(next));
    } catch (e) {
      const unknown = !(e instanceof KjboxError) || e.unreachable || e.code === 'busy_retry' || e.code === 'internal';
      ambiguous.current = unknown ? { sig, id: cid } : null;
      if (e instanceof KjboxError && e.code === 'night_changed') {
        useNightStore.getState().end();
        router.dismissTo('/tonight');
        return;
      }
      const c = errorCopy(e);
      setError(tAll(c.key, c.values));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const methods = tips.data?.methods ?? [];
  const claimMethods = [...methods.map((m) => m.label), t('cash'), t('other')];

  return (
    <SafeAreaView testID="tonight-tips" style={{ flex: 1, backgroundColor: colors.bg }} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerClassName="gap-4 p-4 pb-12" keyboardShouldPersistTaps="handled">
        <Text variant="title">{t('title')}</Text>
        {tips.isPending ? <View testID="tonight-tips-loading" className="h-28 rounded-xl border border-border bg-card" /> : null}
        {tips.isError ? (
          <View testID="tonight-tips-error" className="gap-2">
            <Text variant="error">{t('loadFailed')}</Text>
            <Button testID="tonight-tips-retry" variant="secondary" label={tAll('tonight.night.retry')} onPress={() => void tips.refetch()} />
          </View>
        ) : null}
        {tips.data && !tips.data.enabled ? (
          <Text testID="tonight-tips-off" variant="muted">
            {t('off')}
          </Text>
        ) : null}
        {tips.data?.enabled ? (
          <>
            <Text variant="muted">{t('sub')}</Text>
            {threshold > 0 ? (
              <Text testID="tonight-tips-perk">{t('perk', { amount: t('amount', { amount: fmtAmount(threshold) }) })}</Text>
            ) : null}
            <Text className="font-bold">{t('amountHeading')}</Text>
            <View className="flex-row flex-wrap gap-2">
              {TIP_PRESETS.map((a) => {
                const on = !custom.trim() && amount === a;
                return (
                  <Pressable
                    key={a}
                    testID={`tonight-tips-amount-${a}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      setPreset(a);
                      setCustom('');
                    }}
                    className={`min-h-11 min-w-16 items-center justify-center rounded-lg border px-3 ${on ? 'border-primary bg-primary/10' : 'border-border'}`}
                  >
                    <Text className="font-semibold">{t('amount', { amount: fmtAmount(a) })}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextField testID="tonight-tips-custom" label={t('customLabel')} value={custom} onChangeText={setCustom} keyboardType="decimal-pad" />
            <Text variant="muted">{t('methodsHint')}</Text>
            <View className="gap-2">
              {methods.map((m) =>
                m.amount_style === 'copy' ? (
                  <Pressable
                    key={m.key}
                    testID={`tonight-tips-method-${m.key}`}
                    accessibilityRole="button"
                    onPress={() => void copy(m)}
                    className="min-h-12 justify-center rounded-lg border border-border bg-card px-4"
                  >
                    <Text className="font-semibold">{m.label}</Text>
                    <Text variant="muted">{copied === m.key ? t('copied', { value: m.value ?? '' }) : t('copy', { value: m.value ?? '' })}</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    key={m.key}
                    testID={`tonight-tips-method-${m.key}`}
                    accessibilityRole="link"
                    onPress={() => open(m)}
                    className="min-h-12 justify-center rounded-lg border border-border bg-card px-4"
                  >
                    <Text className="font-semibold">{m.label}</Text>
                    {m.amount_style !== 'none' ? <Text variant="muted">{t('amount', { amount: fmtAmount(amount) })}</Text> : null}
                  </Pressable>
                ),
              )}
            </View>

            <View testID="tonight-tips-claim" className="gap-3 rounded-xl border border-border bg-card p-4">
              <Text className="font-bold">{t('claimTitle')}</Text>
              <Text variant="muted">{t('methodLabel')}</Text>
              <View className="flex-row flex-wrap gap-2">
                {claimMethods.map((label, i) => {
                  const on = method === label;
                  return (
                    <Pressable
                      key={`${i}-${label}`}
                      testID={`tonight-tips-claim-method-${i}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      onPress={() => setMethod(on ? '' : label)}
                      className={`min-h-11 justify-center rounded-lg border px-3 ${on ? 'border-primary bg-primary/10' : 'border-border'}`}
                    >
                      <Text>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {error ? (
                <Text testID="tonight-tips-claim-error" variant="error">
                  {error}
                </Text>
              ) : null}
              <Button testID="tonight-tips-claim-send" label={t('claim')} loading={sending} onPress={() => void claim()} />
            </View>
          </>
        ) : null}

        {claims.length ? (
          <View testID="tonight-tips-claims" className="gap-2">
            <Text className="font-bold">{t('yours')}</Text>
            {claims.map((c) => (
              <View key={c.clientRequestId} testID={`tonight-tips-claim-${c.clientRequestId}`} className="gap-1 rounded-lg border border-border p-3">
                <Text className="font-semibold">
                  {c.method ? t('via', { amount: fmtAmount(c.amount), method: c.method }) : t('plain', { amount: fmtAmount(c.amount) })}
                </Text>
                <Text testID={`tonight-tips-claim-status-${c.clientRequestId}`} variant="muted">
                  {c.status === 'approved' ? t('approved') : c.status === 'rejected' ? t('rejected') : t('pending')}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
