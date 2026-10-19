import {
  ApiError,
  communityCheck,
  createJobFromSearch,
  createJobFromUrl,
  getMe,
  isApiError,
  validateUrl,
  type AudioResult,
} from '@nomad/api-gen';
import { getSearchConfidence } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text, TextField } from '@nomad/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { openSignIn } from '../../auth/signInUi';
import { useAuth } from '../../auth/store';
import { isFreshIntent, useMakeIntent } from '../../make/intentStore';
import { CommunityExists, DidYouMean, MatchNotice } from '../../make/JudgeNotices';
import { PickCard, SourceGroups } from '../../make/SourcePicker';
import { useAudioSearch } from '../../make/useAudioSearch';
import { useMatchJudge } from '../../make/useMatchJudge';

// Only a basic shape check: gen downloads from many sites, and `validateUrl` asks gen before creating.
const LINK = /^https?:\/\/\S+$/i;

type Target = { kind: 'source'; sessionId: string; index: number } | { kind: 'url'; url: string };

/** What a failed create means for the person (spec §4.3 item 8, kjbox make.js `errText`). */
type CreateFailure = 'credits' | 'expired' | 'youtube_blocked' | 'failed';

function createFailure(e: unknown, target: Target): CreateFailure {
  if (isApiError(e, 402)) return 'credits';
  if (!(e instanceof ApiError)) return 'failed';
  const detail = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail ?? '');
  // gen's YouTube download is bot-checked: say it's YouTube, not a generic failure.
  if ([400, 403, 422].includes(e.status) && /youtube/i.test(detail) && /bot/i.test(detail)) return 'youtube_blocked';
  // The search session expired (404), or belongs to another account (403): search again.
  if (target.kind === 'source' && (e.status === 404 || e.status === 403)) return 'expired';
  return 'failed';
}

const goToCredits = () => router.push({ pathname: '/credits', params: { returnTo: '/make/new' } });

/**
 * Spec §4.4: gen finds the audio, the person confirms (or picks another, or pastes a YouTube link), job created.
 * Spec §4.3: gen's match judge runs alongside the search and may tidy or correct the artist/title; the source
 * choice stays closed until it settles, and the job is made with the applied artist/title. A parallel community
 * check says when a community karaoke version already exists.
 */
export default function MakeScreen() {
  const t = useTranslations('make');
  const tAll = useTranslations();
  const clearIntent = useMakeIntent((s) => s.clear);
  // Read once on mount: the 30-minute expiry decides whether to resume a make flow, not whether an open pick
  // card (and its search results) survives someone taking a while to choose.
  const [intent] = useState(() => {
    const stored = useMakeIntent.getState().intent;
    return isFreshIntent(stored) ? stored : null;
  });
  const auth = useAuth((s) => s.state);
  const signedIn = auth.status === 'signedIn';
  const email = signedIn ? auth.session.email : null;
  const queryClient = useQueryClient();

  const [picked, setPicked] = useState<number | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  // gen's `validate-url` said no: its own words, shown under the link box.
  const [linkError, setLinkError] = useState<string | null>(null);
  const [checkingLink, setCheckingLink] = useState(false);
  const [searchedAgain, setSearchedAgain] = useState(false);

  const active = signedIn ? intent : null;
  const search = useAudioSearch(active);
  const me = useQuery({ queryKey: ['me', email], queryFn: getMe, enabled: signedIn });
  // Non-blocking and once per make (gen's /api/catalog/* share a 20/min bucket); a failure shows nothing.
  const community = useQuery({
    queryKey: ['community-check', active?.artist, active?.title],
    queryFn: () => communityCheck({ artist: active!.artist, title: active!.title }),
    enabled: !!active,
    retry: false,
    staleTime: Infinity,
  });

  const results: AudioResult[] = useMemo(() => search.data?.results ?? [], [search.data]);
  // The judge's tier: how well the results match what was searched for.
  const searched = search.variables;
  const searchTier = useMemo(
    () => (search.isSuccess && searched ? getSearchConfidence(results, searched.title, searched.artist).tier : null),
    [search.isSuccess, searched, results],
  );
  // Set while a job is being created (declared before the judge, which must not re-search under a submit).
  const inFlight = useRef(false);
  const judge = useMatchJudge(active, {
    tier: searchTier,
    reSearch: (s) => {
      if (inFlight.current) return;
      setPicked(null);
      search.searchFor(s);
    },
    busy: () => inFlight.current,
  });
  // What's shown and what the job is made with: the applied artist/title.
  const song = useMemo(
    () => judge.applied ?? (intent ? { artist: intent.artist, title: intent.title } : null),
    [judge.applied, intent],
  );
  const confidence = useMemo(
    () => (song && search.data ? getSearchConfidence(results, song.title, song.artist) : null),
    [song, search.data, results],
  );
  const locked = !judge.gateOpen;
  const best = confidence && confidence.tier < 3 ? (confidence.best as AudioResult | null) : null;
  const noResults = search.isSuccess && results.length === 0;
  // Spec §4.3 item 7: the link box comes first, open, when the search found nothing good (tier 3) or nothing.
  const linkFirst = noResults || confidence?.tier === 3;
  const useLink = youtubeOpen || noResults;
  const selectedIndex = picked ?? best?.index ?? null;
  const url = youtubeUrl.trim();
  const urlValid = LINK.test(url);

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
    // Always the applied artist/title (tidied, corrected, or what they typed after Undo).
    mutationFn: ({ to, as }: { to: Target; as: { artist: string; title: string } }) =>
      to.kind === 'url'
        ? createJobFromUrl({ url: to.url, ...as })
        : createJobFromSearch({ sessionId: to.sessionId, index: to.index, ...as }),
    onSuccess: () => {
      // The intent is cleared when this screen unmounts, so it never flashes "Pick a song" on the way out.
      created.current = true;
      router.dismissTo('/(tabs)/make');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e, { to }) => {
      const failure = createFailure(e, to);
      if (failure === 'credits') goToCredits();
      else if (failure === 'expired') {
        // gen's search session expired (or isn't ours): search again and let them confirm the fresh pick.
        setPicked(null);
        setSearchedAgain(true);
        search.run();
      }
    },
  });
  const failure = create.isError && create.variables ? createFailure(create.error, create.variables.to) : null;

  // Review Focus 3: a ref (inFlight, above), not just `disabled`, so two taps in one frame still create one job.
  const submit = async () => {
    if (!target || !song || locked || inFlight.current) return;
    inFlight.current = true;
    if (target.kind === 'url') {
      // Like gen's "Use this URL": ask gen first, so an unsupported link fails here, not after paying.
      setCheckingLink(true);
      try {
        const check = await validateUrl(target.url);
        if (!check.supported) {
          setLinkError(check.detail || t('linkUnsupported'));
          inFlight.current = false;
          return;
        }
      } catch {
        // Fail open, as gen does: create still validates server-side.
      } finally {
        setCheckingLink(false);
      }
    }
    create.mutate({ to: target, as: song }, { onSettled: () => (inFlight.current = false) });
  };

  // Out of credits before searching: straight to credits (spec §4.4).
  const searchError = search.error;
  useEffect(() => {
    if (isApiError(searchError, 402)) goToCredits();
  }, [searchError]);

  // Signed out (session expired mid-flow): reopen sign-in; it returns here with the intent kept.
  useEffect(() => {
    if (!signedIn && intent) openSignIn('/make/new');
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
        {/* dismissTo pops back to the tabs (replace would stack a second (tabs)); with no history it opens Discover. */}
        <Button testID="make-discover" label={t('findSong')} onPress={() => router.dismissTo('/discover')} />
      </Screen>
    );
  }

  const others = best ? results.filter((r) => r.index !== best.index) : results;

  // The link box: typing in it chooses the link (as tapping a source chooses that source).
  const linkBox = (
    <View testID="make-youtube" className="gap-2">
      {linkFirst ? <Text variant="muted">{t('youtubeFallbackHint')}</Text> : null}
      <TextField
        testID="make-youtube-input"
        label={t('youtubeLabel')}
        placeholder={t('youtubePlaceholder')}
        value={youtubeUrl}
        onChangeText={(v) => {
          setYoutubeUrl(v);
          setLinkError(null);
          setYoutubeOpen(true);
        }}
        autoCapitalize="none"
        keyboardType="url"
        error={url && !urlValid ? t('linkInvalid') : undefined}
      />
      {linkError ? (
        <Text testID="youtube-invalid" variant="error">
          {linkError}
        </Text>
      ) : null}
    </View>
  );

  return (
    <Screen testID="make-screen" scroll>
      <View className="gap-1">
        <Text testID="make-song-title" variant="title">
          {song?.title ?? intent.title}
        </Text>
        <Text testID="make-song-artist" variant="muted">
          {song?.artist ?? intent.artist}
        </Text>
      </View>
      {judge.correction ? (
        <MatchNotice correction={judge.correction} onUndo={judge.undo} onRedo={judge.redo} />
      ) : null}
      {judge.suggestions.length > 0 ? <DidYouMean options={judge.suggestions} onPick={judge.acceptAlternative} /> : null}
      {signedIn && community.data ? <CommunityExists check={community.data} /> : null}

      {!signedIn ? (
        <Button
          testID="make-signin"
          label={tAll('account.signIn')}
          onPress={() => openSignIn('/make/new')}
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
          {locked ? (
            <View testID="match-gate-checking" className="flex-row items-center gap-2">
              <ActivityIndicator size="small" />
              <Text variant="muted">{t('matchChecking')}</Text>
            </View>
          ) : null}
          {noResults ? <Text testID="make-no-results">{t('noResults')}</Text> : null}
          {linkFirst ? linkBox : null}
          {best && confidence ? (
            <>
              <PickCard
                result={best}
                tier={confidence.tier}
                confidence={confidence}
                songTitle={song?.title ?? intent.title}
                selected={!useLink && selectedIndex === best.index}
                disabled={locked}
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
              searchTitle={song?.title ?? intent.title}
              expandAll={confidence?.tier === 3}
              selectedIndex={useLink ? null : selectedIndex}
              disabled={locked}
              onSelect={(index) => {
                setPicked(index);
                setYoutubeOpen(false);
              }}
            />
          ) : null}

          {linkFirst ? null : (
            <>
              {/* Tiers 1–2: a good pick is on screen, so YouTube is a last resort behind a small toggle. */}
              <Pressable
                testID="youtube-toggle"
                accessibilityRole="button"
                onPress={() => setYoutubeOpen((v) => !v)}
                className="min-h-11 justify-center self-start"
              >
                <Text className="text-primary">{t('youtubeFallbackToggle')}</Text>
              </Pressable>
              {youtubeOpen ? linkBox : null}
            </>
          )}

          <View testID="make-cost" className="gap-1 rounded-xl border border-border bg-card p-3">
            <Text>{me.data ? t('cost', { credits: me.data.credits }) : t('costOnly')}</Text>
            <Text variant="muted">{t('publicNote')}</Text>
          </View>
          {failure === 'youtube_blocked' ? (
            <Text testID="error-youtube-blocked" variant="error">
              {t('youtubeBlocked')}
            </Text>
          ) : failure === 'failed' ? (
            <Text testID="make-error" variant="error">
              {t('createFailed')}
            </Text>
          ) : null}
          <Button
            testID="make-submit"
            label={t('submit')}
            onPress={() => void submit()}
            disabled={!target || locked || create.isPending || checkingLink}
            loading={create.isPending || checkingLink}
          />
        </>
      )}
    </Screen>
  );
}
