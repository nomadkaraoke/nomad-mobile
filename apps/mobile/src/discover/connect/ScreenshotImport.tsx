import {
  confirmScreenshotItems,
  extractScreenshots,
  type Candidate,
  type ImportResultResponse,
  type UploadFile,
} from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useOffline } from '../../net/useOffline';
import { importErrorKey } from './importErrors';
import { ImportResult } from './ImportResult';
import { useInvalidateAfterImport } from './queries';

/** decide takes at most this many images per request. */
const MAX_IMAGES = 5;
/** Phone screenshots are ~1170-1290 px wide; wider adds bytes, not legibility (decide caps each image at 4 MiB). */
const MAX_WIDTH = 1290;
const JPEG_QUALITY = 0.8;

type Phase = 'picking' | 'reading' | 'confirm' | 'saving' | 'done' | 'error';

/** Drawn in a checked box. */
const CHECK = '\u2713';

const statusOf = (e: unknown) => (e as { status?: unknown } | null)?.status;

/**
 * Shrink to <= MAX_WIDTH wide and re-encode as JPEG so every upload stays well under decide's size cap. The upload
 * part is an expo-file-system File: the app's fetch (expo/fetch) can't send React Native's `{ uri }` parts.
 */
async function prepare(asset: ImagePicker.ImagePickerAsset): Promise<UploadFile> {
  const ctx = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  if (asset.width > MAX_WIDTH) ctx.resize({ width: MAX_WIDTH });
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: JPEG_QUALITY });
  return new File(out.uri);
}

/**
 * Screenshot import (spec §5.2): pick up to 5 screenshots, shrink them, let decide's Gemini read the artists and
 * songs, then the user unticks anything wrong before it is saved. Nothing is written until "Add".
 */
export function ScreenshotImport() {
  const t = useTranslations('connect');
  const tAll = useTranslations();
  const offline = useOffline();
  const invalidate = useInvalidateAfterImport();
  const [phase, setPhase] = useState<Phase>('picking');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [result, setResult] = useState<ImportResultResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  /** Set the moment a picker opens: a double tap must not open two (state updates are too late for that). */
  const picking = useRef(false);

  const fail = (e: unknown) => {
    setErrorMessage(statusOf(e) === 429 ? t('screenshot.dailyLimit') : tAll(importErrorKey(e, 'screenshot')));
    setPhase('error');
  };

  const pickAndRead = async () => {
    if (picking.current || phase === 'reading' || phase === 'saving') return;
    picking.current = true;
    try {
      await pickAndReadOnce();
    } finally {
      picking.current = false;
    }
  };

  const pickAndReadOnce = async () => {
    let picked: ImagePicker.ImagePickerResult;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_IMAGES,
      });
    } catch (e) {
      fail(e);
      return;
    }
    if (picked.canceled || picked.assets.length === 0) {
      setPhase('picking');
      return;
    }
    setErrorMessage('');
    setPhase('reading');
    try {
      const files = await Promise.all(picked.assets.slice(0, MAX_IMAGES).map(prepare));
      const { candidates: found } = await extractScreenshots(files);
      setCandidates(found);
      setChecked(found.map(() => true));
      setPhase('confirm');
    } catch (e) {
      fail(e);
    }
  };

  const save = async () => {
    if (phase !== 'confirm') return;
    const items = candidates
      .filter((_, i) => checked[i])
      // A song with no title is just an artist.
      .map((c) => (c.kind === 'song' && c.title ? { kind: c.kind, artist: c.artist, title: c.title } : { kind: 'artist' as const, artist: c.artist, title: null }));
    setErrorMessage('');
    setPhase('saving');
    try {
      setResult(await confirmScreenshotItems(items));
      invalidate();
      setPhase('done');
    } catch (e) {
      // Keep the picks on screen so a retry doesn't cost another Gemini read.
      setErrorMessage(statusOf(e) === 429 ? t('screenshot.dailyLimit') : tAll(importErrorKey(e, 'screenshot')));
      setPhase('confirm');
    }
  };

  const toggle = (i: number) => setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)));
  const count = checked.filter(Boolean).length;
  const busy = phase === 'reading' || phase === 'saving';

  return (
    <Screen testID="connect-screenshot" scroll underHeader>
      <Text variant="muted">{t('screenshot.intro')}</Text>
      {offline ? (
        <Text testID="connect-offline" variant="error" accessibilityLiveRegion="polite">
          {t('offline')}
        </Text>
      ) : null}
      {phase === 'picking' || phase === 'reading' ? (
        <>
          <Text variant="muted">{t('screenshot.limit')}</Text>
          <Button
            testID="connect-shot-pick"
            label={t('screenshot.pick')}
            onPress={() => void pickAndRead()}
            disabled={offline}
            loading={phase === 'reading'}
          />
          {phase === 'reading' ? (
            <Text testID="connect-shot-progress" accessibilityLiveRegion="polite">
              {t('screenshot.reading')}
            </Text>
          ) : null}
        </>
      ) : null}
      {phase === 'confirm' || phase === 'saving' ? (
        candidates.length === 0 ? (
          <>
            <Text testID="connect-shot-empty">{t('screenshot.empty')}</Text>
            <Button testID="connect-shot-retry" label={t('screenshot.pickMore')} onPress={() => void pickAndRead()} />
          </>
        ) : (
          <>
            <Text className="text-lg font-semibold">{t('screenshot.confirmTitle')}</Text>
            <Text variant="muted">{t('screenshot.confirmBody')}</Text>
            {candidates.map((c, i) => (
              <Pressable
                key={`${c.kind}-${c.artist}-${c.title ?? ''}-${i}`}
                testID={`connect-shot-item-${i}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: checked[i] === true, disabled: busy }}
                disabled={busy}
                onPress={() => toggle(i)}
                className="min-h-11 flex-row items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                <View
                  className={`size-6 items-center justify-center rounded border border-primary ${checked[i] ? 'bg-primary' : 'bg-transparent'}`}
                >
                  {checked[i] ? <Text className="text-sm font-bold text-primary-foreground">{CHECK}</Text> : null}
                </View>
                <View className="flex-1 gap-1">
                  <Text className="font-semibold">
                    {c.kind === 'song' && c.title ? t('screenshot.item', { artist: c.artist, title: c.title }) : c.artist}
                  </Text>
                  {!c.matched ? <Text variant="muted">{t('screenshot.unmatched')}</Text> : null}
                </View>
              </Pressable>
            ))}
            {errorMessage ? (
              <Text testID="connect-shot-error" variant="error" accessibilityLiveRegion="polite">
                {errorMessage}
              </Text>
            ) : null}
            <Button
              testID="connect-shot-confirm"
              label={t('screenshot.confirm', { count })}
              onPress={() => void save()}
              disabled={count === 0 || offline}
              loading={phase === 'saving'}
            />
          </>
        )
      ) : null}
      {phase === 'done' && result ? (
        <>
          <ImportResult artists={result.artists_added} songs={result.songs_added} />
          <Button
            testID="connect-shot-again"
            variant="secondary"
            label={t('screenshot.again')}
            onPress={() => setPhase('picking')}
          />
        </>
      ) : null}
      {phase === 'error' ? (
        <>
          <Text testID="connect-shot-error" variant="error" accessibilityLiveRegion="polite">
            {errorMessage}
          </Text>
          <Button testID="connect-shot-retry" label={t('screenshot.retry')} onPress={() => setPhase('picking')} />
        </>
      ) : null}
    </Screen>
  );
}
