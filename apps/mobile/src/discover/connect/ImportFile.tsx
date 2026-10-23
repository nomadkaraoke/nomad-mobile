import { ApiError, uploadExportToListenBrainz, type RNFile } from '@nomad/api-decide';
import { toUploadChunks, type ExportKind, type ExportSummary } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useOffline } from '../../net/useOffline';
import { importErrorKey } from './importErrors';
import { RETRY_DELAYS_MS, retryDelayMs, useImportQueue } from './importQueue';
import { ImportResult } from './ImportResult';
import { useCapabilities, useServicesSummary } from './queries';
import { readExportFile } from './readExport';
import { cancelExportReminder } from './reminders';

const PICK_TYPES = ['application/zip', 'text/csv', 'text/comma-separated-values'];
const LB_IMPORT_PAGE = 'https://listenbrainz.org/settings/import/';
/** decide's proxied ListenBrainz upload cap when the capability doesn't say (Cloud Run's request cap is 32 MiB). */
const LB_DEFAULT_MAX_BYTES = 30 * 1024 * 1024;

const KIND_KEY: Record<ExportKind, 'spotifyAccount' | 'spotifyExtended' | 'apple'> = {
  'spotify-account': 'spotifyAccount',
  'spotify-extended': 'spotifyExtended',
  apple: 'apple',
};

/**
 * Opens the system file picker for a privacy export and, when a file is picked, the import screen for it. The
 * picker copies the file into the app's cache, so the reader gets a `file://` uri with a known size.
 */
export async function pickExportFile(replace = false): Promise<void> {
  const res = await DocumentPicker.getDocumentAsync({ type: PICK_TYPES, copyToCacheDirectory: true });
  const asset = res.canceled ? undefined : res.assets?.[0];
  if (!asset) return;
  const to = { pathname: '/discover/connect/import-file', params: { file: asset.uri, name: asset.name } } as unknown as Href;
  if (replace) router.replace(to);
  else router.push(to);
}

function fileSize(uri: string): number | null {
  try {
    return new File(uri).size ?? null;
  } catch {
    return null;
  }
}

type Read = { step: 'reading'; pct: number } | { step: 'read'; summary: ExportSummary } | { step: 'failed'; error: unknown };
/** 'idle' covers "not asked" and "in flight": the in-flight state is derived, never set from an effect. */
type Lb =
  | { step: 'idle' }
  | { step: 'sent' }
  | { step: 'failed'; message: 'lbBusy' | 'lbReconnect' | null; error: unknown };

const isRetryable = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status === 429 || e.status >= 500;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Hands the zip to ListenBrainz through decide, retrying 5xx / 429 / network errors (5, 15, 30, 60 s or Retry-After). */
async function sendToListenBrainz(file: RNFile, alive: () => boolean): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await uploadExportToListenBrainz(file);
      return;
    } catch (e) {
      if (!isRetryable(e) || attempt > RETRY_DELAYS_MS.length || !alive()) throw e;
      await sleep(retryDelayMs(attempt, e instanceof ApiError ? e.retryAfter : null));
      if (!alive()) throw e;
    }
  }
}

/** decide's 409s for the ListenBrainz upload, in words. */
function lbMessage(e: unknown): 'lbBusy' | 'lbReconnect' | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  return e.detail === 'import_in_progress' ? 'lbBusy' : 'lbReconnect'; // not_oauth_connected / needs_reconnect
}

/**
 * Imports a picked Spotify / Apple privacy export (Phase 3b spec §5.4): parsed on the phone (works offline), a
 * preview, then its upload chunks go to the offline queue, which sends them once online. Optionally hands an
 * Extended history zip to ListenBrainz too, so new listens keep flowing.
 */
export function ImportFile({ uri, name }: { uri: string; name: string }) {
  const t = useTranslations('connect');
  const tAll = useTranslations();
  const offline = useOffline();
  const sources = useServicesSummary();
  const capabilities = useCapabilities();
  const enqueue = useImportQueue((s) => s.enqueue);
  const [read, setRead] = useState<Read>({ step: 'reading', pct: 0 });
  const [submitted, setSubmitted] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [lbAlso, setLbAlso] = useState(false);
  const [lb, setLb] = useState<Lb>({ step: 'idle' });
  const lbStarted = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    readExportFile(uri, {
      signal: controller.signal,
      onProgress: (done, total) => {
        const pct = total > 0 ? Math.floor((done / total) * 100) : 0;
        setRead((r) => (r.step === 'reading' && r.pct !== pct ? { step: 'reading', pct } : r));
      },
    }).then(
      (summary) => setRead({ step: 'read', summary }),
      (error: unknown) => {
        if (!controller.signal.aborted) setRead({ step: 'failed', error });
      },
    );
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [uri]);

  const summary = read.step === 'read' ? read.summary : null;
  const chunks = useMemo(() => (summary ? toUploadChunks(summary) : []), [summary]);
  const size = useMemo(() => fileSize(uri), [uri]);

  const lbConnected = sources.data?.sources.some((s) => s.source === 'listenbrainz' && s.connected && s.auth === 'oauth');
  const lbOffer = summary?.kind === 'spotify-extended' && lbConnected === true;
  const maxBytes = capabilities.data?.listenbrainz_upload_max_bytes ?? LB_DEFAULT_MAX_BYTES;
  const lbTooBig = size !== null && size > maxBytes;

  const batch = useImportQueue((s) => (batchId ? s.batches[batchId] : undefined));
  const lastError = useImportQueue((s) => s.lastError);
  // An empty import makes no batch record: it is done as soon as it is submitted.
  const done = submitted && (batchId === null || (!!batch && batch.sent + batch.failed >= batch.chunks));
  const failed = batch?.failed ?? 0;

  // A finished import makes its Spotify reminders pointless: Account data cancels the 5-day one, Extended both.
  const cancelled = useRef(false);
  useEffect(() => {
    if (!done || failed > 0 || cancelled.current || !summary) return;
    cancelled.current = true;
    if (summary.kind === 'spotify-account') void cancelExportReminder('account');
    if (summary.kind === 'spotify-extended') {
      void cancelExportReminder('account');
      void cancelExportReminder('extended');
    }
  }, [done, failed, summary]);

  // The ListenBrainz hand-off starts once submitted and online.
  useEffect(() => {
    if (!submitted || !lbAlso || lbStarted.current || offline) return;
    lbStarted.current = true;
    sendToListenBrainz({ uri, name: name || 'my_spotify_data.zip', type: 'application/zip' }, () => alive.current).then(
      () => alive.current && setLb({ step: 'sent' }),
      (error: unknown) => alive.current && setLb({ step: 'failed', message: lbMessage(error), error }),
    );
  }, [submitted, lbAlso, offline, uri, name]);

  const start = () => {
    if (!summary || submitted) return;
    setBatchId(chunks.length ? enqueue(chunks, summary.kind === 'apple' ? 'apple' : 'spotify') : null);
    setSubmitted(true);
  };

  const pct = read.step === 'reading' ? read.pct : 100;
  const hasTracks = (summary?.tracks.length ?? 0) > 0;

  return (
    <Screen testID="connect-import-file" scroll underHeader>
      {read.step === 'reading' ? (
        <>
          <Text accessibilityLiveRegion="polite">{t('importFile.reading')}</Text>
          <View
            testID="connect-import-progress"
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: pct }}
            className="my-1 h-1.5 overflow-hidden rounded-full bg-border"
          >
            <View className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </View>
        </>
      ) : null}

      {read.step === 'failed' ? (
        <>
          <Text testID="connect-import-error" variant="error" accessibilityLiveRegion="polite">
            {tAll(importErrorKey(read.error, 'export'))}
          </Text>
          <Button testID="connect-import-pick" label={t('importFile.pickAnother')} onPress={() => void pickExportFile(true)} />
        </>
      ) : null}

      {summary ? (
        <>
          {hasTracks ? (
            <Text testID="connect-import-preview" className="text-lg font-semibold">
              {t('importFile.preview', { tracks: summary.tracks.length, kind: t(`importFile.kind.${KIND_KEY[summary.kind]}`) })}
            </Text>
          ) : (
            <>
              <Text className="text-lg font-semibold">{t('importFile.nothing')}</Text>
              <Text testID="connect-import-skipped" variant="muted">
                {t('importFile.skipped', summary.skipped)}
              </Text>
            </>
          )}
          {summary.truncated ? (
            <Text testID="connect-import-truncated" variant="error">
              {t('importFile.truncated')}
            </Text>
          ) : null}

          {lbOffer && !submitted ? (
            lbTooBig ? (
              <LbTooBigLink />
            ) : (
              <Pressable
                testID="connect-lb-also"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: lbAlso }}
                onPress={() => setLbAlso((v) => !v)}
                className="min-h-11 flex-row items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                <View className={`size-6 rounded border border-primary ${lbAlso ? 'bg-primary' : 'bg-transparent'}`} />
                <Text className="flex-1">{t('importFile.lbAlso')}</Text>
              </Pressable>
            )
          ) : null}

          {chunks.length > 0 && !submitted ? (
            <Button testID="connect-import-start" label={t('importFile.start')} onPress={start} />
          ) : null}

          {submitted && !done ? (
            <Text testID={offline ? 'connect-import-waiting' : 'connect-import-sending'} accessibilityLiveRegion="polite">
              {offline ? t('importFile.waiting') : t('importFile.sending')}
            </Text>
          ) : null}

          {done && batch ? <ImportResult artists={batch.artistsAdded} songs={batch.songsAdded} /> : null}
          {done && failed > 0 ? (
            <Text testID="connect-import-error" variant="error" accessibilityLiveRegion="polite">
              {tAll(importErrorKey(lastError?.batch === batchId ? lastError : null, 'export'))}
            </Text>
          ) : null}

          {submitted && lbAlso && lb.step === 'idle' && !offline ? <Text testID="connect-lb-sending">{t('importFile.lbSending')}</Text> : null}
          {lb.step === 'sent' ? <Text testID="connect-lb-sent">{t('importFile.lbSent')}</Text> : null}
          {lb.step === 'failed' ? (
            lb.message === null && lb.error instanceof ApiError && lb.error.status === 413 ? (
              <LbTooBigLink />
            ) : (
              <Text testID="connect-lb-error" variant="error" accessibilityLiveRegion="polite">
                {lb.message ? t(`importFile.${lb.message}`) : tAll(importErrorKey(lb.error, 'listenbrainz'))}
              </Text>
            )
          ) : null}

          {done || (!hasTracks && chunks.length === 0) ? (
            <Button
              testID="connect-import-pick"
              variant="secondary"
              label={t('importFile.pickAnother')}
              onPress={() => void pickExportFile(true)}
            />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

/** Shown instead of the ListenBrainz checkbox when the zip is over decide's upload cap. */
function LbTooBigLink() {
  const t = useTranslations('connect');
  return (
    <Pressable
      testID="connect-lb-too-big"
      accessibilityRole="link"
      onPress={() => void WebBrowser.openBrowserAsync(LB_IMPORT_PAGE)}
      className="min-h-11 justify-center"
    >
      <Text className="text-primary underline">{t('importFile.lbTooBig')}</Text>
    </Pressable>
  );
}
