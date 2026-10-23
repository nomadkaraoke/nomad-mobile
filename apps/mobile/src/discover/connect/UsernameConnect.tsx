import { useTranslations } from '@nomad/i18n';
import { Button, Text, TextField } from '@nomad/ui';
import { useState } from 'react';

import { importErrorKey } from './importErrors';
import { ImportResult } from './ImportResult';
import type { SyncCounts, SyncPhase } from './useSyncWait';

/**
 * A polled service's username box (ListenBrainz, Last.fm): `connect` stores the connection (decide checks the
 * name exists: 422 when it doesn't), then `onConnected` starts the sync.
 */
export function UsernameConnect({
  service,
  label,
  submitLabel,
  connect,
  onConnected,
  disabled,
}: {
  service: 'listenbrainz' | 'lastfm';
  label: string;
  submitLabel: string;
  connect: (username: string) => Promise<unknown>;
  onConnected: () => void;
  disabled: boolean;
}) {
  const tAll = useTranslations();
  const id = service === 'listenbrainz' ? 'lb' : 'lastfm';
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const username = name.trim();
    if (busy || !username) return;
    setBusy(true);
    setError('');
    try {
      await connect(username);
      onConnected();
    } catch (e) {
      setError(tAll(importErrorKey(e, service)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TextField
        testID={`connect-${id}-username`}
        label={label}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError('');
        }}
        autoCapitalize="none"
        autoComplete="username"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        error={error || undefined}
      />
      <Button
        testID={`connect-${id}-submit`}
        label={submitLabel}
        onPress={() => void submit()}
        disabled={name.trim() === '' || disabled}
        loading={busy}
      />
    </>
  );
}

/** Where the sync after connecting is: reading, what it added, still going, or failed. */
export function SyncStatus({ phase, counts }: { phase: SyncPhase; counts: SyncCounts | null }) {
  const t = useTranslations('connect.sync');
  if (phase === 'idle') return null;
  if (phase === 'done') {
    return counts ? (
      <ImportResult artists={counts.artists} songs={counts.songs} />
    ) : (
      <Text testID="connect-import-result" accessibilityLiveRegion="polite" className="font-semibold">
        {t('done')}
      </Text>
    );
  }
  const [testID, key, variant] =
    phase === 'syncing'
      ? (['connect-sync-progress', 'reading', 'body'] as const)
      : phase === 'slow'
        ? (['connect-sync-slow', 'slow', 'muted'] as const)
        : (['connect-sync-failed', 'failed', 'error'] as const);
  return (
    <Text testID={testID} variant={variant} accessibilityLiveRegion="polite">
      {t(key)}
    </Text>
  );
}
