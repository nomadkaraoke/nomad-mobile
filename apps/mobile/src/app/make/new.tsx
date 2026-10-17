import {
  createJobFromSearch,
  createJobFromUrl,
  getMe,
  isApiError,
  type AudioResult,
} from '@nomad/api-gen';
import { getSearchConfidence } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text, TextField } from '@nomad/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useAuth } from '../../auth/store';
import { isFreshIntent, useMakeIntent } from '../../make/intentStore';
import { PickCard, SourceGroups } from '../../make/SourcePicker';
import { useAudioSearch } from '../../make/useAudioSearch';

const YOUTUBE_URL = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be)\/\S+$/i;

type Target = { kind: 'source'; sessionId: string; index: number } | { kind: 'url'; url: string };

const goToCredits = () => router.push({ pathname: '/credits', params: { returnTo: '/make/new' } });

/** Spec §4.4: gen finds the audio, the person confirms (or picks another, or pastes a YouTube link), job created. */
export default function MakeScreen() {
  const t = useTranslations('make');
  const tAll = useTranslations();
  const storedIntent = useMakeIntent((s) => s.intent);
  const clearIntent = useMakeIntent((s) => s.clear);
  const intent = isFreshIntent(storedIntent) ? storedIntent : null;
  const auth = useAuth((s) => s.state);
  const signedIn = auth.status === 'signedIn';
  const email = signedIn ? auth.session.email : null;
  const queryClient = useQueryClient();

  const search = useAudioSearch(signedIn ? intent : null);
  const me = useQuery({ queryKey: ['me', email], queryFn: getMe, enabled: signedIn });

  const [picked, setPicked] = useState<number | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [searchedAgain, setSearchedAgain] = useState(false);

  const results: AudioResult[] = useMemo(() => search.data?.results ?? [], [search.data]);
  const confidence = useMemo(
    () => (intent && search.data ? getSearchConfidence(results, intent.title, intent.artist) : null),
    [intent, search.data, results],
  );
  const best = confidence && confidence.tier < 3 ? (confidence.best as AudioResult | null) : null;
  const noResults = search.isSuccess && results.length === 0;
  const useLink = youtubeOpen || noResults;
  const selectedIndex = picked ?? best?.index ?? null;
  const url = youtubeUrl.trim();
  const urlValid = YOUTUBE_URL.test(url);

  const target: Target | null = useLink
    ? urlValid
      ? { kind: 'url', url }
      : null
    : search.data && selectedIndex !== null
      ? { kind: 'source', sessionId: search.data.sessionId, index: selectedIndex }
      : null;

  const created = useRef(false);
  useEffect(
    () => () => {
      if (created.current) clearIntent();
    },
    [clearIntent],
  );

  const create = useMutation({
    mutationFn: (to: Target) => {
      const song = { artist: intent!.artist, title: intent!.title };
      return to.kind === 'url'
        ? createJobFromUrl({ url: to.url, ...song })
        : createJobFromSearch({ sessionId: to.sessionId, index: to.index, ...song });
    },
    onSuccess: () => {
      // The intent is cleared when this screen unmounts, so it never flashes "Pick a song" on the way out.
      created.current = true;
      router.dismissTo('/(tabs)/make');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => {
      if (isApiError(e, 402)) goToCredits();
      else if (isApiError(e, 404)) {
        // gen's search session expired: search again and let them confirm the fresh pick.
        setPicked(null);
        setSearchedAgain(true);
        search.run();
      }
    },
  });

  // Review Focus 3: a ref, not just `disabled`, so two taps in one frame still create one job.
  const inFlight = useRef(false);
  const submit = () => {
    if (!target || inFlight.current) return;
    inFlight.current = true;
    create.mutate(target, { onSettled: () => (inFlight.current = false) });
  };

  // Out of credits before searching: straight to credits (spec §4.4).
  const searchError = search.error;
  useEffect(() => {
    if (isApiError(searchError, 402)) goToCredits();
  }, [searchError]);

  // Signed out (session expired mid-flow): reopen sign-in; it returns here with the intent kept.
  useEffect(() => {
    if (!signedIn && intent) router.push({ pathname: '/sign-in', params: { returnTo: '/make/new' } });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the sign-in state changes
  }, [signedIn]);

  // Back from checkout or sign-in: refresh the balance and pick the search back up if it was blocked.
  const latest = useRef({ search, me, signedIn });
  useEffect(() => {
    latest.current = { search, me, signedIn };
  });
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      const { search: s, me: m, signedIn: ok } = latest.current;
      if (!ok) return;
      if (isApiError(s.error, 401)) s.run();
      void m.refetch().then((r) => {
        if (isApiError(s.error, 402) && (r.data?.credits ?? 0) > 0) s.run();
      });
    }, []),
  );

  if (!intent) {
    return (
      <Screen testID="make-screen">
        <Text testID="make-no-intent">{t('noIntent')}</Text>
        <Button testID="make-discover" label={t('findSong')} onPress={() => router.replace('/discover')} />
      </Screen>
    );
  }

  const others = best ? results.filter((r) => r.index !== best.index) : results;

  return (
    <Screen testID="make-screen" scroll>
      <View className="gap-1">
        <Text variant="title">{intent.title}</Text>
        <Text variant="muted">{intent.artist}</Text>
      </View>

      {!signedIn ? (
        <Button
          testID="make-signin"
          label={tAll('account.signIn')}
          onPress={() => router.push({ pathname: '/sign-in', params: { returnTo: '/make/new' } })}
        />
      ) : search.isPending || search.isIdle ? (
        <View testID="make-searching" className="items-center gap-2 py-8">
          <ActivityIndicator />
          <Text>{t('searching')}</Text>
          <Text variant="muted">{t('searchingHint')}</Text>
        </View>
      ) : isApiError(search.error, 402) ? (
        <Button testID="make-get-credits" label={t('getCredits')} onPress={goToCredits} />
      ) : search.isError ? (
        <View className="items-start gap-2">
          <Text variant="error">{t('searchFailed')}</Text>
          <Button testID="make-retry" label={tAll('common.retry')} variant="secondary" onPress={search.run} />
        </View>
      ) : (
        <>
          {searchedAgain ? <Text variant="muted">{t('searchExpired')}</Text> : null}
          {noResults ? <Text testID="make-no-results">{t('noResults')}</Text> : null}
          {best && confidence ? (
            <>
              <PickCard
                result={best}
                tier={confidence.tier}
                songTitle={intent.title}
                selected={!useLink && selectedIndex === best.index}
                onPress={() => {
                  setPicked(best.index);
                  setYoutubeOpen(false);
                }}
              />
              {others.length > 0 ? (
                <Pressable
                  testID="make-other-sources"
                  accessibilityRole="button"
                  onPress={() => setShowOthers((v) => !v)}
                  className="min-h-11 justify-center self-start"
                >
                  <Text className="text-primary">
                    {showOthers ? t('hideOtherSources') : t('seeOtherSources', { count: others.length })}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : results.length > 0 ? (
            <Text>{t('notSure')}</Text>
          ) : null}
          {results.length > 0 && (!best || showOthers) ? (
            <SourceGroups
              results={others}
              selectedIndex={useLink ? null : selectedIndex}
              onSelect={(index) => {
                setPicked(index);
                setYoutubeOpen(false);
              }}
            />
          ) : null}

          {noResults ? null : (
            <Pressable
              testID="make-youtube-toggle"
              accessibilityRole="button"
              onPress={() => setYoutubeOpen((v) => !v)}
              className="min-h-11 justify-center self-start"
            >
              <Text className="text-primary">{t('youtubeToggle')}</Text>
            </Pressable>
          )}
          {useLink ? (
            <TextField
              testID="make-youtube-input"
              label={t('youtubeLabel')}
              placeholder={t('youtubePlaceholder')}
              value={youtubeUrl}
              onChangeText={setYoutubeUrl}
              autoCapitalize="none"
              keyboardType="url"
              error={url && !urlValid ? t('youtubeInvalid') : undefined}
            />
          ) : null}

          <View testID="make-cost" className="gap-1 rounded-xl border border-border bg-card p-3">
            <Text>{me.data ? t('cost', { credits: me.data.credits }) : t('costOnly')}</Text>
            <Text variant="muted">{t('publicNote')}</Text>
          </View>
          {create.isError && !isApiError(create.error, 402) && !isApiError(create.error, 404) ? (
            <Text testID="make-error" variant="error">
              {t('createFailed')}
            </Text>
          ) : null}
          <Button
            testID="make-submit"
            label={t('submit')}
            onPress={submit}
            disabled={!target || create.isPending}
            loading={create.isPending}
          />
        </>
      )}
    </Screen>
  );
}
