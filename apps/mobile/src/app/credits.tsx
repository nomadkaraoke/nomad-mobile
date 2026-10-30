import { getCreditCatalog, getMe, type CreditCatalog, type CreditPackage, type WebLink } from '@nomad/api-gen';
import { formatPrice } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button, colors, Screen, Text } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';

import { isInAppPath, openSignIn } from '../auth/signInUi';
import { useAuth } from '../auth/store';
import { displayCredits } from '../credits/balance';
import { createPurchaseLock } from '../credits/purchaseLock';
import { getPurchases, type PurchasesAdapter, type StoreProduct } from '../credits/purchases';
import { useCheckout, type CheckoutPhase } from '../credits/useCheckout';
import { useStorePurchase, type StorePurchasePhase } from '../credits/useStorePurchase';
import { currentLocale } from '../locale';

const DEFAULT_PACKAGE = '3_credits';
const POPULAR = '3_credits';
const BEST_VALUE = '10_credits';
const DEFAULT_WEB_LINK_COPY = 'credits.webLink.default';

type Phase = CheckoutPhase | StorePurchasePhase;

/** "$6" for whole-unit per-credit prices, "$8.33" otherwise (in the currency's own minor digits: "¥600"). */
const perCredit = (amount: number, credits: number, currency: string, locale: string) => {
  const each = amount / credits;
  const digits = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(each) ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(each);
};

type CatalogQuery = { data?: CreditCatalog; isPending: boolean; isError: boolean; refetch: () => unknown };

/**
 * Spec §4.5 / Phase 6: pick a package and pay, then land back where the person came from. With in-app purchases on
 * (a RevenueCat key, or the local stack's fake) the store sells the packs, plus a web link where gen's `web_link`
 * allows it for the store country; with them off, today's web checkout.
 */
export default function CreditsScreen() {
  const t = useTranslations('credits');
  const ta = useTranslations('account');
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const auth = useAuth((s) => s.state);
  const email = auth.status === 'signedIn' ? auth.session.email : null;

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

  const catalog = useQuery({ queryKey: ['credit-packages'], queryFn: getCreditCatalog, enabled: Boolean(email) });

  if (!email) {
    return (
      <Screen testID="credits-screen">
        <Text variant="title">{t('title')}</Text>
        <Text variant="muted">{t('signInPrompt')}</Text>
        <Button testID="credits-signin" label={ta('signIn')} onPress={() => openSignIn(signInReturn)} />
      </Screen>
    );
  }
  // Ruling R36: a gen that predates store product ids (no package has one) keeps the web checkout.
  const storeSells = !catalog.data || catalog.data.packages.some((p) => p.storeProductId);
  const adapter = storeSells ? getPurchases() : null;
  return adapter ? (
    <StoreCreditsBody adapter={adapter} email={email} returnTo={returnTo} catalog={catalog} />
  ) : (
    <WebCreditsBody email={email} returnTo={returnTo} catalog={catalog} />
  );
}

type BodyProps = { email: string; returnTo: string | undefined; catalog: CatalogQuery };

/** Paid and credited: back to where the person came from (the make flow still holds the song). */
function useLeaveWhenAdded(phase: string, returnTo: string | undefined) {
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
}

/** Today's web checkout (IAP off): Stripe in an in-app browser. */
function WebCreditsBody({ email, returnTo, catalog }: BodyProps) {
  const t = useTranslations('credits');
  const locale = currentLocale();
  const checkout = useCheckout(email);
  const { phase } = checkout;
  const [selected, setSelected] = useState(DEFAULT_PACKAGE);
  useLeaveWhenAdded(phase, returnTo);

  const packages = catalog.data?.packages;
  const chosen = packages?.find((p) => p.id === selected) ?? packages?.[0];
  const locked = phase === 'pending';

  return (
    <Screen testID="credits-screen" scroll>
      <Header email={email} />
      <PhaseBanners phase={phase} failedText={t('checkoutFailed')} onRefresh={() => void checkout.refresh()} />
      <PackageList
        catalog={catalog}
        items={packages?.map((p) => ({
          pkg: p,
          price: formatPrice(p.priceCents, 'USD', locale),
          each: perCredit(p.priceCents / 100, p.credits, 'USD', locale),
        }))}
        chosenId={chosen?.id}
        onSelect={setSelected}
        disabled={locked}
      />
      <Button
        testID="credits-checkout"
        label={t('checkout')}
        loading={checkout.busy}
        disabled={!chosen || phase === 'added' || locked}
        onPress={() => chosen && void checkout.start(chosen.id)}
      />
    </Screen>
  );
}

/** Whether gen's `web_link` rollout lists this store country for this platform. */
const webLinkAllowed = (link: WebLink | undefined, country: string | null | undefined) => {
  if (!link || !country) return false;
  const list = Platform.OS === 'ios' ? link.showFor.ios : Platform.OS === 'android' ? link.showFor.android : [];
  return list.some((c) => c.toUpperCase() === country.toUpperCase());
};

// Once per launch: Sentry keeps console warnings as breadcrumbs, so a crash report shows the store had no packs.
let warnedNoStoreProducts = false;

/**
 * In-app purchases on: store prices and the store sheet; the web checkout only where `web_link` allows it.
 * Ruling R43: a store that knows none of gen's product ids (not created in the console yet) sells nothing, so the
 * screen falls back to today's web checkout instead of a dead "couldn't load" with Retry.
 */
function StoreCreditsBody({ adapter, email, returnTo, catalog }: BodyProps & { adapter: PurchasesAdapter }) {
  const t = useTranslations('credits');
  const tAll = useTranslations();
  const locale = currentLocale();
  // One guard for both channels: Buy and the web link can't start two payments at once.
  const [lock] = useState(createPurchaseLock);
  const store = useStorePurchase(adapter, email, lock);
  const checkout = useCheckout(email, lock);
  const [channel, setChannel] = useState<'iap' | 'web'>('iap');
  const [selected, setSelected] = useState(DEFAULT_PACKAGE);
  const phase: Phase = channel === 'web' ? checkout.phase : store.phase;
  useLeaveWhenAdded(phase, returnTo);

  const storeIds = (catalog.data?.packages ?? []).flatMap((p) => (p.storeProductId ? [p.storeProductId] : []));
  const products = useQuery({
    queryKey: ['credit-store-products', storeIds],
    queryFn: () => adapter.products(storeIds),
    enabled: storeIds.length > 0,
  });
  // The store country decides the web link; an unknown country (or a failed lookup) shows none.
  const country = useQuery({ queryKey: ['store-country'], queryFn: () => adapter.storefrontCountry(), staleTime: Infinity });
  const me = useQuery({ queryKey: ['me', email], queryFn: getMe });

  // Only packs the store actually sells (gen maps them, the store knows the product).
  const byId = new Map<string, StoreProduct>((products.data ?? []).map((p) => [p.id, p]));
  const items = (catalog.data?.packages ?? []).flatMap((pkg) => {
    const product = pkg.storeProductId ? byId.get(pkg.storeProductId) : undefined;
    return product && pkg.storeProductId ? [{ pkg, storeProductId: pkg.storeProductId, product }] : [];
  });
  const chosen = items.find((i) => i.pkg.id === selected) ?? items[0];
  const webLink = catalog.data?.webLink;
  const showWebLink = webLinkAllowed(webLink, country.data);
  const copyKey = webLink && tAll.has(webLink.copyKey) ? webLink.copyKey : DEFAULT_WEB_LINK_COPY;
  const discount = me.data?.referralDiscountPercent;

  const storeSellsNone = !catalog.isPending && !catalog.isError && products.isSuccess && items.length === 0;
  useEffect(() => {
    if (!storeSellsNone || warnedNoStoreProducts) return;
    warnedNoStoreProducts = true;
    console.warn(`[credits] the store returned none of ${storeIds.length} product ids; using the web checkout`);
  }, [storeSellsNone, storeIds.length]);

  const busy = store.busy || checkout.busy;
  const locked = phase === 'pending' || phase === 'added';
  // A disabled query (no store ids: an older gen) also reads as pending, so only count it when it runs.
  const productsPending = storeIds.length > 0 && products.isPending;
  const listQuery: CatalogQuery = {
    data: catalog.data,
    isPending: catalog.isPending || productsPending,
    isError: catalog.isError || products.isError,
    refetch: () => {
      void catalog.refetch();
      void products.refetch();
    },
  };

  if (storeSellsNone) return <WebCreditsBody email={email} returnTo={returnTo} catalog={catalog} />;

  return (
    <Screen testID="credits-screen" scroll>
      <Header email={email} />
      {/* App Review 3.1.1: the note points at web buying, so only where the web link is offered. */}
      {discount && showWebLink ? (
        <Text variant="muted" testID="credits-referral-note">
          {t('referralNote', { percent: discount })}
        </Text>
      ) : null}
      <PhaseBanners
        phase={phase}
        failedText={channel === 'web' ? t('checkoutFailed') : t('purchaseFailed')}
        onRefresh={() => void (channel === 'web' ? checkout.refresh() : store.refresh())}
      />
      <PackageList
        catalog={listQuery}
        items={items.map(({ pkg, product }) => ({
          pkg,
          price: product.priceString,
          each: perCredit(product.price, pkg.credits, product.currency, locale),
        }))}
        chosenId={chosen?.pkg.id}
        onSelect={setSelected}
        disabled={locked || busy}
      />
      <Button
        testID="credits-buy"
        label={chosen ? t('buyFor', { price: chosen.product.priceString }) : t('buy')}
        loading={store.busy}
        disabled={!chosen || locked || checkout.busy}
        onPress={() => {
          if (!chosen) return;
          setChannel('iap');
          void store.start({ id: chosen.pkg.id, storeProductId: chosen.storeProductId });
        }}
      />
      {showWebLink ? (
        <Button
          testID="credits-web-link"
          variant="secondary"
          label={tAll(copyKey)}
          loading={checkout.busy}
          disabled={!chosen || locked || store.busy}
          onPress={() => {
            if (!chosen) return;
            setChannel('web');
            void checkout.start(chosen.pkg.id);
          }}
        />
      ) : null}
    </Screen>
  );
}

/** Title, explainer and the balance (a refund can take gen's balance below 0: shown as 0). */
function Header({ email }: { email: string }) {
  const t = useTranslations('credits');
  const me = useQuery({ queryKey: ['me', email], queryFn: getMe });
  return (
    <>
      <Text variant="title">{t('title')}</Text>
      <Text variant="muted">{t('explainer')}</Text>
      {me.data ? (
        <Text testID="credits-balance">{t('balance', { credits: displayCredits(me.data.credits) })}</Text>
      ) : null}
    </>
  );
}

function PhaseBanners({ phase, failedText, onRefresh }: { phase: Phase; failedText: string; onRefresh: () => void }) {
  const t = useTranslations('credits');
  return (
    <>
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
          <Button testID="credits-refresh" variant="secondary" label={t('refresh')} onPress={onRefresh} />
        </View>
      ) : null}
      {phase === 'awaitingApproval' ? (
        <View testID="credits-awaiting-approval" className="rounded-lg border border-border bg-card p-3">
          <Text variant="muted">{t('store.awaitingApproval')}</Text>
        </View>
      ) : null}
      {phase === 'failed' ? <Text variant="error" testID="credits-failed">{failedText}</Text> : null}
    </>
  );
}

type PackageItem = { pkg: CreditPackage; price: string; each: string };

function PackageList({
  catalog,
  items,
  chosenId,
  onSelect,
  disabled,
}: {
  catalog: CatalogQuery;
  items: PackageItem[] | undefined;
  chosenId: string | undefined;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations('credits');
  const tc = useTranslations('common');
  if (catalog.isPending) return <ActivityIndicator testID="credits-loading" />;
  if (catalog.isError || !items) {
    return (
      <View className="items-start gap-2">
        <Text variant="error">{t('loadFailed')}</Text>
        <Button testID="credits-retry" variant="secondary" label={tc('retry')} onPress={() => void catalog.refetch()} />
      </View>
    );
  }
  return (
    <>
      {items.map(({ pkg: p, price, each }) => {
        const on = p.id === chosenId;
        const badge =
          p.id === POPULAR
            ? { label: t('popular'), cls: 'bg-primary/15 text-primary' }
            : p.id === BEST_VALUE
              ? { label: t('each', { price: each }), cls: 'bg-gold/15 text-gold' }
              : null;
        return (
          <Pressable
            key={p.id}
            testID={`credits-pkg-${p.id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled }}
            disabled={disabled}
            onPress={() => onSelect(p.id)}
            className={`flex-row items-center justify-between rounded-lg border p-4 ${on ? 'border-primary bg-card' : 'border-border'}`}
          >
            <View className="shrink flex-row flex-wrap items-center gap-2">
              <Text>{t('packageCredits', { credits: p.credits })}</Text>
              {badge ? (
                <Text testID={`credits-badge-${p.id}`} className={`overflow-hidden rounded-full px-2 py-0.5 text-xs font-bold ${badge.cls}`}>
                  {badge.label}
                </Text>
              ) : null}
            </View>
            <Text className="font-bold">{price}</Text>
          </Pressable>
        );
      })}
    </>
  );
}
