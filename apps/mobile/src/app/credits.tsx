import { listCreditPackages, type CreditPackage } from '@nomad/api-gen';
import { formatPrice } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button, colors, Screen, Text } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { isInAppPath, openSignIn } from '../auth/signInUi';
import { useAuth } from '../auth/store';
import { useCheckout } from '../credits/useCheckout';
import { currentLocale } from '../locale';

const DEFAULT_PACKAGE = '3_credits';
const POPULAR = '3_credits';
const BEST_VALUE = '10_credits';

/** "$6" for whole-dollar per-credit prices, "$8.33" otherwise. */
const perCredit = (p: CreditPackage, locale: string) => {
  const dollars = p.priceCents / p.credits / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
  }).format(dollars);
};

/** Spec §4.5: pick a package, pay in an in-app browser, land back where the person came from. */
export default function CreditsScreen() {
  const t = useTranslations('credits');
  const ta = useTranslations('account');
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const auth = useAuth((s) => s.state);
  const email = auth.status === 'signedIn' ? auth.session.email : null;
  const [selected, setSelected] = useState(DEFAULT_PACKAGE);
  const locale = currentLocale();

  // Signed out: the sign-in sheet returns here.
  // Keep the original returnTo through sign-in so the purchase still ends back in the make flow.
  const signInReturn = returnTo && isInAppPath(returnTo) ? `/credits?returnTo=${encodeURIComponent(returnTo)}` : '/credits';
  const askedSignIn = useRef(false);
  useEffect(() => {
    if (auth.status === 'signedOut' && !askedSignIn.current) {
      askedSignIn.current = true;
      openSignIn(signInReturn);
    }
  }, [auth.status, signInReturn]);

  const packages = useQuery({ queryKey: ['credit-packages'], queryFn: listCreditPackages, enabled: Boolean(email) });

  if (!email) {
    return (
      <Screen testID="credits-screen">
        <Text variant="title">{t('title')}</Text>
        <Text variant="muted">{t('signInPrompt')}</Text>
        <Button testID="credits-signin" label={ta('signIn')} onPress={() => openSignIn(signInReturn)} />
      </Screen>
    );
  }
  return (
    <CreditsBody
      email={email}
      returnTo={returnTo}
      packages={packages}
      selected={selected}
      setSelected={setSelected}
      locale={locale}
    />
  );
}

type BodyProps = {
  email: string;
  returnTo: string | undefined;
  packages: { data?: CreditPackage[]; isPending: boolean; isError: boolean; refetch: () => unknown };
  selected: string;
  setSelected: (id: string) => void;
  locale: string;
};

function CreditsBody({ email, returnTo, packages, selected, setSelected, locale }: BodyProps) {
  const t = useTranslations('credits');
  const tc = useTranslations('common');
  const checkout = useCheckout(email);
  const { phase } = checkout;

  // Paid and credited: back to where the person came from (the make flow still holds the song).
  const left = useRef(false);
  useEffect(() => {
    if (phase !== 'added' || left.current) return;
    left.current = true;
    const timer = setTimeout(() => {
      // Back when there is history (replacing would stack a second (tabs) under the root); a cold-start
      // credits screen has none, so it is replaced with returnTo, or Me where the balance shows.
      const target = returnTo && isInAppPath(returnTo) ? (returnTo as Href) : '/me';
      if (router.canGoBack()) router.back();
      else router.replace(target);
    }, 1500); // long enough to read "Credits added" before the make flow comes back
    return () => clearTimeout(timer);
  }, [phase, returnTo]);

  const chosen = packages.data?.find((p) => p.id === selected) ?? packages.data?.[0];

  return (
    <Screen testID="credits-screen" scroll>
      <Text variant="title">{t('title')}</Text>
      <Text variant="muted">{t('explainer')}</Text>

      {phase === 'added' ? (
        <View testID="credits-added" className="flex-row items-center gap-2 rounded-lg border border-success/40 bg-success/10 p-3">
          <Ionicons name="checkmark-circle" size={22} color={colors.success} accessibilityElementsHidden importantForAccessibility="no" />
          <Text className="font-semibold text-success">{t('added')}</Text>
        </View>
      ) : null}
      {phase === 'noPayment' ? (
        <View testID="credits-no-payment" className="rounded-lg border border-border bg-card p-3">
          <Text variant="muted">{t('noPayment')}</Text>
        </View>
      ) : null}
      {phase === 'pending' ? (
        <View testID="credits-pending" className="gap-2 rounded-lg border border-border bg-card p-3">
          <Text>{t('pending')}</Text>
          <Button testID="credits-refresh" variant="secondary" label={t('refresh')} onPress={() => void checkout.refresh()} />
        </View>
      ) : null}
      {phase === 'failed' ? <Text variant="error" testID="credits-failed">{t('checkoutFailed')}</Text> : null}

      {packages.isPending ? (
        <ActivityIndicator testID="credits-loading" />
      ) : packages.isError || !packages.data ? (
        <View className="items-start gap-2">
          <Text variant="error">{t('loadFailed')}</Text>
          <Button testID="credits-retry" variant="secondary" label={tc('retry')} onPress={() => void packages.refetch()} />
        </View>
      ) : (
        packages.data.map((p) => {
          const on = p.id === chosen?.id;
          const badge =
            p.id === POPULAR
              ? { label: t('popular'), cls: 'bg-primary/15 text-primary' }
              : p.id === BEST_VALUE
                ? { label: t('each', { price: perCredit(p, locale) }), cls: 'bg-gold/15 text-gold' }
                : null;
          return (
            <Pressable
              key={p.id}
              testID={`credits-pkg-${p.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              disabled={phase === 'pending'}
              onPress={() => setSelected(p.id)}
              className={`flex-row items-center justify-between rounded-lg border p-4 ${on ? 'border-primary bg-card' : 'border-border'}`}
            >
              <View className="shrink flex-row flex-wrap items-center gap-2">
                <Text>{t('packageCredits', { credits: p.credits })}</Text>
                {badge ? (
                  <Text
                    testID={`credits-badge-${p.id}`}
                    className={`overflow-hidden rounded-full px-2 py-0.5 text-xs font-bold ${badge.cls}`}
                  >
                    {badge.label}
                  </Text>
                ) : null}
              </View>
              <Text className="font-bold">{formatPrice(p.priceCents, 'USD', locale)}</Text>
            </Pressable>
          );
        })
      )}

      <Button
        testID="credits-checkout"
        label={t('checkout')}
        loading={checkout.busy}
        disabled={!chosen || phase === 'added' || phase === 'pending'}
        onPress={() => chosen && void checkout.start(chosen.id)}
      />
    </Screen>
  );
}
