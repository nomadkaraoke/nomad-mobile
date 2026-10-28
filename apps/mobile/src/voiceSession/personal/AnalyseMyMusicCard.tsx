// "Analyse my music" (Phase 3d Part F): asks decide to prepare up to `cap` of the singer's most-played songs for the
// voice session, overnight. On Me (under the recordings) and under the session intro. Hidden unless decide says the
// singer is eligible, and while the first read is loading (no spinner, so the screen doesn't jump).
import { useFormatter, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';

import { ProfileSection } from '../../discover/profile/ProfileSection';
import { usePersonalPool } from './usePersonalPool';

/** `onFindVoice`: where "find your voice" goes (default: the voice session; the intro passes its own Start). */
export function AnalyseMyMusicCard({ onFindVoice }: { onFindVoice?: () => void }) {
  const t = useTranslations('voiceSession.personal');
  const format = useFormatter();
  const { view, busy, problem, request } = usePersonalPool();
  if (view.kind === 'hidden') return null;

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  // The refusal's own date wins (it is the newest word); else the pool's.
  const capUntil = problem?.kind === 'cap' ? (problem.nextAllowedAt ?? view.capUntil) : view.capUntil;
  const capped = !!capUntil && view.preparing === null;
  const findVoice = onFindVoice ?? (() => router.push('/discover/voice-session' as Href));

  return (
    <ProfileSection testID="vs-personal" title={t('title')} isEmpty={false} empty="">
      {view.firstTime && !capped ? (
        <Text testID="vs-personal-body" variant="muted">
          {t('body', { cap: view.cap })}
        </Text>
      ) : null}
      {view.preparing !== null ? <Text testID="vs-personal-preparing">{t('preparing', { total: view.preparing })}</Text> : null}
      {view.ready > 0 ? (
        <Button testID="vs-personal-ready" label={t('ready', { ready: view.ready })} variant="secondary" onPress={findVoice} />
      ) : null}
      {capped && capUntil ? (
        <Text testID="vs-personal-cap" variant="muted">
          {t('cap', { date: date(capUntil) })}
        </Text>
      ) : null}
      {view.canRequest && !capped ? (
        <Button testID="vs-personal-request" label={t('request')} onPress={() => void request()} loading={busy} />
      ) : null}
      {problem?.kind === 'paused' ? (
        <Text testID="vs-personal-paused" variant="muted">
          {t('paused')}
        </Text>
      ) : null}
      {problem?.kind === 'nothingToAdd' ? (
        <Text testID="vs-personal-nothing" variant="muted">
          {t('nothingToAdd')}
        </Text>
      ) : null}
      {problem?.kind === 'failed' ? (
        <Text testID="vs-personal-failed" variant="error">
          {t('failed')}
        </Text>
      ) : null}
    </ProfileSection>
  );
}
