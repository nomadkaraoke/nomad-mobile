import { getNight, joinNight, KjboxError, type NightClosed, type NightOpen } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text, TextField } from '@nomad/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { openSignIn } from '../auth/signInUi';
import { useAuth } from '../auth/store';
import { CodeEntry } from './CodeEntry';
import { parseNightLink } from './links';
import { useNightStore } from './nightStore';
import { Unreachable } from './nomad/Unreachable';
import { errorCopy } from './request/errorCopy';
import { TonightSheet } from './TonightSheet';

type Phase =
  | { kind: 'loading' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'badCode' }
  | { kind: 'closed'; night: NightClosed }
  | { kind: 'switch'; night: NightOpen }
  | { kind: 'name'; night: NightOpen }
  | { kind: 'joined' };

/** Where sign-in returns to: this join, for this code. */
export const joinPath = (code: string) => `/tonight/join?t=${encodeURIComponent(code)}`;

const isUnreachable = (e: unknown) => !(e instanceof KjboxError) || e.unreachable;

/**
 * Joining a Nomad night from a QR, link or typed code (spec §4.2, ruling E3-R4). Needs sign-in (opens it and comes
 * back here), then asks the box about tonight: closed/not started → the host's message and retry; a code that isn't
 * tonight's → re-entry; another night active → "Switch to this night?"; first time → "What should the host call you?"
 * (prefilled from `suggested_name`) → POST /join; then records the night and lands on Tonight.
 */
export function JoinScreen() {
  const t = useTranslations('tonight.join');
  const tNight = useTranslations('tonight.night');
  const tAll = useTranslations();
  const params = useLocalSearchParams<{ t?: string }>();
  const code = parseNightLink(typeof params.t === 'string' ? params.t : '')?.code ?? null;
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [sheetOpen, setSheetOpen] = useState(true);
  // Latest load wins: a retry or a new code makes earlier answers stale.
  const generation = useRef(0);
  const askedSignIn = useRef(false);

  const finish = (c: string, night: NightOpen) => {
    useNightStore.getState().joinNomad(c, night.night_id, night.kj_name);
    setPhase({ kind: 'joined' });
    router.replace('/tonight');
  };

  const proceed = (c: string, night: NightOpen, switchConfirmed: boolean) => {
    const current = useNightStore.getState().current();
    const elsewhere = current !== null && !(current.kind === 'nomad' && current.nightId === night.night_id);
    if (elsewhere && !switchConfirmed) {
      setSheetOpen(true);
      setPhase({ kind: 'switch', night });
    } else if (night.needs_name) {
      setSheetOpen(true);
      setPhase({ kind: 'name', night });
    } else {
      finish(c, night);
    }
  };

  /** Asks the box about tonight. Callers in handlers show the loading state first (`reload`). */
  const load = (c: string): Promise<void> => {
    const mine = ++generation.current;
    const current = () => mine === generation.current;
    return getNight(c).then(
      (night) => {
        if (!current()) return;
        if (night.open) proceed(c, night, false);
        else setPhase(night.reason === 'bad_code' ? { kind: 'badCode' } : { kind: 'closed', night });
      },
      (e: unknown) => {
        if (current()) setPhase({ kind: 'failed', error: e });
      },
    );
  };

  useEffect(() => {
    if (!code) return;
    if (!signedIn) {
      // Once per visit; the button below asks again if the sheet was dismissed.
      if (!askedSignIn.current) {
        askedSignIn.current = true;
        openSignIn(joinPath(code));
      }
      return;
    }
    void load(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- (re)load when the code or the sign-in changes
  }, [code, signedIn]);

  const reload = (c: string) => {
    setPhase({ kind: 'loading' });
    void load(c);
  };

  const reenter = (next: string) => {
    if (next === code) reload(next);
    else {
      setPhase({ kind: 'loading' });
      router.setParams({ t: next });
    }
  };

  const retry = () => {
    if (code) reload(code);
  };

  const keep = () => {
    setSheetOpen(false);
    router.replace('/tonight');
  };

  let body: ReactNode;
  if (!code || phase.kind === 'badCode') {
    body = (
      <>
        <Text testID="tonight-join-bad-code">{t('badCode')}</Text>
        <CodeEntry onCode={reenter} />
      </>
    );
  } else if (!signedIn) {
    body = (
      <>
        <Text>{t('signIn')}</Text>
        <Button testID="tonight-join-sign-in" label={t('signInButton')} onPress={() => openSignIn(joinPath(code))} />
      </>
    );
  } else if (phase.kind === 'closed') {
    body = (
      <View testID="tonight-join-closed" className="gap-2 rounded-xl border border-border bg-card p-4">
        <Text>{phase.night.reason === 'no_night' ? t('notStarted') : t('closed')}</Text>
        {phase.night.footer_message ? <Text variant="muted">{phase.night.footer_message}</Text> : null}
        <Button testID="tonight-join-retry" variant="secondary" label={tNight('retry')} onPress={retry} />
      </View>
    );
  } else if (phase.kind === 'failed') {
    const c = errorCopy(phase.error);
    body = (
      <>
        {isUnreachable(phase.error) ? <Unreachable hasSongs={false} /> : <Text testID="tonight-join-error">{tAll(c.key, c.values)}</Text>}
        <Button testID="tonight-join-retry" variant="secondary" label={tNight('retry')} onPress={retry} />
      </>
    );
  } else if (phase.kind === 'switch') {
    // Always on the page as well as in the sheet: if iOS drops the sheet, the singer is never stuck here.
    const night = phase.night;
    body = (
      <>
        <Text variant="muted">{t('switchBody')}</Text>
        <Button testID="tonight-join-switch" label={t('switchConfirm')} onPress={() => proceed(code, night, true)} />
        <Button testID="tonight-join-keep" variant="secondary" label={t('switchKeep')} onPress={keep} />
      </>
    );
  } else if (phase.kind === 'name') {
    body = <Button testID="tonight-join-name-open" label={t('nameOpen')} onPress={() => setSheetOpen(true)} />;
  } else {
    body = (
      <Text testID="tonight-join-loading" variant="muted">
        {t('loading')}
      </Text>
    );
  }

  // One sheet for both questions: swapping two RN Modals at once drops the second on iOS.
  const asking = (phase.kind === 'switch' || phase.kind === 'name') && sheetOpen;
  return (
    <Screen testID="tonight-join" scroll>
      <Text variant="title">{t('title')}</Text>
      {body}
      <TonightSheet
        visible={asking}
        testID={phase.kind === 'switch' ? 'tonight-switch-sheet' : 'tonight-name-sheet'}
        title={phase.kind === 'switch' ? t('switchTitle') : t('nameTitle')}
        closeLabel={t('close')}
        onClose={phase.kind === 'switch' ? keep : () => setSheetOpen(false)}
      >
        {phase.kind === 'switch' && code ? (
          <View className="gap-3 pb-2">
            <Text variant="muted">{t('switchBody')}</Text>
            <Button testID="tonight-switch-confirm" label={t('switchConfirm')} onPress={() => proceed(code, phase.night, true)} />
            <Button testID="tonight-switch-keep" variant="secondary" label={t('switchKeep')} onPress={keep} />
          </View>
        ) : null}
        {phase.kind === 'name' && code ? (
          <NameForm
            key={phase.night.night_id}
            code={code}
            night={phase.night}
            onJoined={() => finish(code, phase.night)}
            onNightMoved={() => reload(code)}
          />
        ) : null}
      </TonightSheet>
    </Screen>
  );
}

/** Longest name the app sends (the field stops there; a longer prefill must be shortened first). */
const NAME_MAX = 100;

type NameFormProps = { code: string; night: NightOpen; onJoined: () => void; onNightMoved: () => void };

/** "What should the host call you?" (A.87–A.90): prefilled from the gen account when kjbox suggests a name. */
function NameForm({ code, night, onJoined, onNightMoved }: NameFormProps) {
  const t = useTranslations('tonight.join');
  const tAll = useTranslations();
  const [name, setName] = useState(night.suggested_name ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= NAME_MAX;

  const confirm = async () => {
    if (!valid || sending) return;
    setSending(true);
    setError(null);
    try {
      await joinNight(code, trimmed, night.night_id);
      onJoined();
    } catch (e) {
      setSending(false);
      // The host started a new night or closed requests meanwhile: ask the box again.
      if (e instanceof KjboxError && (e.code === 'night_changed' || e.code === 'not_open')) onNightMoved();
      else {
        const c = errorCopy(e);
        setError(tAll(c.key, c.values));
      }
    }
  };

  return (
    <View className="gap-3 pb-2">
      <Text variant="muted">{t('nameBody')}</Text>
      <TextField
        testID="tonight-name-input"
        label={t('nameLabel')}
        placeholder={t('namePlaceholder')}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoComplete="given-name"
        textContentType="givenName"
        autoFocus
        returnKeyType="go"
        onSubmitEditing={() => void confirm()}
        maxLength={NAME_MAX}
      />
      {error ? (
        <Text testID="tonight-name-error" variant="error">
          {error}
        </Text>
      ) : null}
      <Button testID="tonight-name-confirm" label={t('nameConfirm')} disabled={!valid} loading={sending} onPress={() => void confirm()} />
    </View>
  );
}
