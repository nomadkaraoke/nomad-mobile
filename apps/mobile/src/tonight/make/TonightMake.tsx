import { getMe as getGenMe, type AudioResult } from '@nomad/api-gen';
import { getNight, KjboxError, makeValidateUrl, submitRequest, type Night } from '@nomad/api-kjbox';
import { getSearchConfidence } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, NomadLoader, Screen, Text, TextField } from '@nomad/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { openSignIn } from '../../auth/signInUi';
import { useAuth } from '../../auth/store';
import type { MakeIntent } from '../../make/intentStore';
import { DidYouMean, MatchNotice } from '../../make/JudgeNotices';
import { PickCard, SourceGroups } from '../../make/SourcePicker';
import { useAudioSearch } from '../../make/useAudioSearch';
import { useMatchJudge } from '../../make/useMatchJudge';
import { consentFields, loadNightConsent } from '../manage/NightConsent';
import { storedPhone } from '../manage/PhoneSheet';
import { useNightStore, type NomadNight } from '../nightStore';
import { nightKey } from '../nomad/queries';
import { NIGHT_ROUTE } from '../request/ConfirmScreen';
import { errorCopy } from '../request/errorCopy';
import { newRequestId, useRequestStore } from '../request/requestStore';
import { kjboxJudge, kjboxSearcher } from './kjboxMake';
import { MakeStillPending, sendMake } from './sendMake';

// Only a basic shape check: gen downloads from many sites, and the box asks gen (validate-url) before sending.
const LINK = /^https?:\/\/\S+$/i;

type Song = { artist: string; title: string };
type Target = { kind: 'source'; sessionId: string; index: number } | { kind: 'url'; url: string };

export type TonightMakeProps = {
  /** What search pre-filled (E5): the identified song, or the typed words with an empty artist. */
  artist: string;
  title: string;
  /** A song for a friend (A.10): arrives as a route param, since the request flow clears on leaving search. */
  friend?: string;
};

/** The box refused because the gen session didn't check out: ask gen itself, whose 401 is what signs out. */
const checkGenSession = () => void getGenMe().catch(() => {});

function FriendLine({ name }: { name: string }) {
  const t = useTranslations('tonight.make');
  return (
    <Text testID="tonight-make-friend" className="font-semibold">
      {t('forFriend', { name: isolate(name) })}
    </Text>
  );
}

function AskHost({ simple }: { simple?: boolean }) {
  const t = useTranslations('tonight.request');
  const tMake = useTranslations('tonight.make');
  return (
    <View className="gap-3">
      <Text testID="tonight-make-ask-host">{simple ? t('emptySimple') : t('askHost')}</Text>
      <Button testID="tonight-make-back" variant="secondary" label={tMake('back')} onPress={() => router.back()} />
    </View>
  );
}

/**
 * Make on the spot (spec §4.3, A.65–A.79): Phase 1's make flow (audio search → pick → confirm) with the search, the
 * match judge and the submit going through kjbox, so the job gets tonight's free show credit, a "Being made" rotation
 * entry and the quick version. The job lands in the singer's own gen account. Hidden ("Ask the host") when the box
 * says make is off or in Simple Mode (ruling E7-R1, A.78), and refused while a song is being changed (ruling E7-R4,
 * A.39). After a successful submit, the night queries are invalidated and the singer goes back to Tonight, where the
 * "Being made" row arrives through /me (ruling E7-R3).
 */
export function TonightMake({ artist, title, friend }: TonightMakeProps) {
  const t = useTranslations('tonight.make');
  const tConfirm = useTranslations('tonight.request.confirm');
  const night = useNightStore((s) => s.active);
  const userKey = useNightStore((s) => s.userKey);
  // Read once: a change keeps its queue slot, and a make-it can't replace a song (E5 offers no make in change mode).
  const [changing] = useState(() => useRequestStore.getState().mode === 'change');

  if (night?.kind !== 'nomad') {
    return (
      <Screen testID="tonight-make-screen">
        <Text testID="tonight-make-night-ended">{tConfirm('nightEnded')}</Text>
        <Button
          testID="tonight-make-night-ended-back"
          variant="secondary"
          label={tConfirm('backToTonight')}
          onPress={() => router.dismissTo(NIGHT_ROUTE)}
        />
      </Screen>
    );
  }
  if (changing) {
    return (
      <Screen testID="tonight-make-screen">
        <Text testID="tonight-make-refused">{t('refusedChange')}</Text>
        <Button testID="tonight-make-back" variant="secondary" label={t('back')} onPress={() => router.back()} />
      </Screen>
    );
  }
  return <MakeGate night={night} userKey={userKey} artist={artist} title={title} friend={friend} />;
}

/** GET /night's features decide whether make is on offer tonight (shares the night screen's cached read). */
function MakeGate(props: TonightMakeProps & { night: NomadNight; userKey: string | null }) {
  const { night, userKey } = props;
  const tAll = useTranslations();
  const t = useTranslations('tonight.make');
  const info = useQuery<Night>({
    queryKey: [...nightKey(night, userKey), 'night'],
    queryFn: () => getNight(night.code, night.nightId),
    staleTime: 60_000,
    retry: false,
  });
  const auth = useAuth((s) => s.state);

  let body;
  if (info.isPending) {
    body = (
      <View testID="tonight-make-loading" className="items-center py-8">
        <ActivityIndicator />
      </View>
    );
  } else if (info.isError) {
    const c = errorCopy(info.error);
    body = (
      <View className="gap-2">
        <Text testID="tonight-make-error" variant="error">
          {tAll(c.key, c.values)}
        </Text>
        <Button testID="tonight-make-retry" variant="secondary" label={t('retry')} onPress={() => void info.refetch()} />
      </View>
    );
  } else if (!info.data.open) {
    body = (
      <View className="gap-3">
        <Text testID="tonight-make-closed">{tAll('tonight.errors.notOpen')}</Text>
        <Button testID="tonight-make-back" variant="secondary" label={t('back')} onPress={() => router.back()} />
      </View>
    );
  } else if (!info.data.features.make || info.data.features.simple_mode) {
    body = <AskHost />;
  } else if (auth.status !== 'signedIn') {
    body = <Button testID="tonight-make-signin" label={tAll('account.signIn')} onPress={() => openSignIn(NIGHT_ROUTE)} />;
  } else {
    return <MakeFlow {...props} />;
  }
  return (
    <Screen testID="tonight-make-screen" scroll>
      {body}
    </Screen>
  );
}

/** The song to make: what search pre-filled, or a short form when the artist (or title) is still missing. */
function MakeFlow(props: TonightMakeProps & { night: NomadNight; userKey: string | null }) {
  const t = useTranslations('tonight.make');
  const [song, setSong] = useState<Song | null>(() =>
    props.artist.trim() && props.title.trim() ? { artist: props.artist.trim(), title: props.title.trim() } : null,
  );
  const [draft, setDraft] = useState({ artist: props.artist.trim(), title: props.title.trim() });
  if (song) return <MakeSearch {...props} song={song} />;
  const ready = draft.artist.trim() !== '' && draft.title.trim() !== '';
  return (
    <Screen testID="tonight-make-screen" scroll>
      <View testID="tonight-make-song-form" className="gap-3">
        <Text variant="title">{t('formTitle')}</Text>
        <Text variant="muted">{t('formHint')}</Text>
        {props.friend ? <FriendLine name={props.friend} /> : null}
        <TextField
          testID="tonight-make-artist-input"
          label={t('artistLabel')}
          value={draft.artist}
          onChangeText={(v) => setDraft((d) => ({ ...d, artist: v }))}
          autoFocus={!draft.artist}
        />
        <TextField
          testID="tonight-make-title-input"
          label={t('titleLabel')}
          value={draft.title}
          onChangeText={(v) => setDraft((d) => ({ ...d, title: v }))}
        />
        <Button
          testID="tonight-make-find-audio"
          label={t('findAudio')}
          disabled={!ready}
          onPress={() => setSong({ artist: draft.artist.trim(), title: draft.title.trim() })}
        />
      </View>
    </Screen>
  );
}

function MakeSearch({ night, userKey, friend, song: wanted }: TonightMakeProps & { night: NomadNight; userKey: string | null; song: Song }) {
  const t = useTranslations('tonight.make');
  const tMake = useTranslations('make');
  const tAll = useTranslations();
  const queryClient = useQueryClient();

  // A typed intent with no pre-fill to protect: the judge may tidy or correct either field (useMatchJudge).
  const [intent] = useState<MakeIntent>(() => ({ ...wanted, source: 'typed', editedFields: [], createdAt: Date.now() }));
  const searcher = useMemo(() => kjboxSearcher(night), [night]);
  const judgeFn = useMemo(() => kjboxJudge(night), [night]);

  const [picked, setPicked] = useState<number | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askHost, setAskHost] = useState(false);

  const search = useAudioSearch(intent, searcher);
  const results: AudioResult[] = useMemo(() => search.data?.results ?? [], [search.data]);
  const searched = search.variables;
  const searchTier = useMemo(
    () => (search.isSuccess && searched ? getSearchConfidence(results, searched.title, searched.artist).tier : null),
    [search.isSuccess, searched, results],
  );
  // Set while sending (a ref, not just `disabled`: two taps in one frame still send once, Review Focus 3).
  const inFlight = useRef(false);
  const judge = useMatchJudge(
    intent,
    {
      tier: searchTier,
      reSearch: (s) => {
        if (inFlight.current) return;
        setPicked(null);
        search.searchFor(s);
      },
      busy: () => inFlight.current,
    },
    judgeFn,
  );
  const song = judge.applied ?? wanted;
  const confidence = useMemo(
    () => (search.data ? getSearchConfidence(results, song.title, song.artist) : null),
    [song, search.data, results],
  );
  const locked = !judge.gateOpen;
  const best = confidence && confidence.tier < 3 ? (confidence.best as AudioResult | null) : null;
  const noResults = search.isSuccess && results.length === 0;
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

  // The search's own failures: make switched off mid-flow → "Ask the host"; a refused session → gen decides.
  const searchError = search.error;
  const searchDisabled = searchError instanceof KjboxError && searchError.code === 'make_disabled';
  useEffect(() => {
    if (searchError instanceof KjboxError && searchError.code === 'unauthenticated') checkGenSession();
    if (searchError instanceof KjboxError && searchError.code === 'night_changed') {
      useNightStore.getState().end();
      router.dismissTo(NIGHT_ROUTE);
    }
  }, [searchError]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // One client_request_id per song + source: every retry of the same make reuses it, so the box makes one job.
  const requestId = useRef<{ sig: string; id: string } | null>(null);

  const send = async () => {
    if (!target || locked || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setWaiting(false);
    setError(null);
    try {
      if (target.kind === 'url') {
        // Like gen's "Use this URL": ask first, so an unsupported link fails here. Fails open (the box checks again).
        try {
          const check = await makeValidateUrl(night.code, target.url, night.nightId);
          if (!check.supported) {
            const detail = typeof check.detail === 'string' ? check.detail : '';
            setLinkError(detail || tMake('linkUnsupported'));
            return;
          }
        } catch {
          // fail open
        }
      }
      const sourceMeta =
        target.kind === 'url' ? { youtube_url: target.url } : { search_session_id: target.sessionId, selection_index: target.index };
      const sig = JSON.stringify([song.artist, song.title, sourceMeta, friend ?? null]);
      if (requestId.current?.sig !== sig) requestId.current = { sig, id: newRequestId() };
      const phone = friend ? null : storedPhone(userKey);
      const body = {
        source_type: 'make' as const,
        song_artist: song.artist,
        song_title: song.title,
        source_meta: sourceMeta,
        night_id: night.nightId,
        client_request_id: requestId.current.id,
        ...(friend ? { for_friend: true, friend_name: friend } : {}),
        ...(phone ? { phone } : {}),
        // The night's photo answer, only ever given when the host asked (A.91); never on a friend's song.
        ...(friend ? {} : consentFields(loadNightConsent(userKey, night.nightId))),
      };
      await sendMake(() => submitRequest(night.code, body), {
        onWaiting: () => setWaiting(true),
        alive: () => alive.current,
      });
      if (!alive.current) return;
      void queryClient.invalidateQueries({ queryKey: nightKey(night, userKey) });
      router.dismissTo(NIGHT_ROUTE);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof KjboxError && e.code === 'night_changed') {
        useNightStore.getState().end();
        router.dismissTo(NIGHT_ROUTE);
        return;
      }
      if (e instanceof MakeStillPending) {
        setError(t('stillPending'));
        return;
      }
      if (e instanceof KjboxError && e.code === 'make_disabled') {
        setAskHost(true);
        return;
      }
      if (e instanceof KjboxError && e.code === 'unauthenticated') checkGenSession();
      const c = errorCopy(e);
      setError(tAll(c.key, c.values));
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setSending(false);
        setWaiting(false);
      }
    }
  };

  if (askHost || searchDisabled) {
    return (
      <Screen testID="tonight-make-screen" scroll>
        <AskHost />
      </Screen>
    );
  }

  const others = best ? results.filter((r) => r.index !== best.index) : results;
  const choose = (index: number) => {
    setPicked(index);
    setLinkError(null);
    setYoutubeOpen(false);
  };
  const linkBox = (
    <View testID="make-youtube" className="gap-2">
      {linkFirst ? <Text variant="muted">{tMake('youtubeFallbackHint')}</Text> : null}
      <TextField
        testID="make-youtube-input"
        label={tMake('youtubeLabel')}
        placeholder={tMake('youtubePlaceholder')}
        value={youtubeUrl}
        onChangeText={(v) => {
          setYoutubeUrl(v);
          setLinkError(null);
          setYoutubeOpen(true);
        }}
        autoCapitalize="none"
        keyboardType="url"
        error={url && !urlValid ? tMake('linkInvalid') : undefined}
      />
      {linkError ? (
        <Text testID="youtube-invalid" variant="error">
          {linkError}
        </Text>
      ) : null}
    </View>
  );
  const searchErr = search.isError && !searchDisabled ? errorCopy(search.error) : null;

  return (
    <Screen testID="tonight-make-screen" scroll>
      <View className="gap-1">
        <Text testID="tonight-make-song-title" variant="title">
          {song.title}
        </Text>
        <Text testID="tonight-make-song-artist" variant="muted">
          {song.artist}
        </Text>
        {friend ? <FriendLine name={friend} /> : null}
      </View>
      {judge.correction ? <MatchNotice correction={judge.correction} onUndo={judge.undo} onRedo={judge.redo} /> : null}
      {judge.suggestions.length > 0 ? <DidYouMean options={judge.suggestions} onPick={judge.acceptAlternative} /> : null}

      {search.isPending || search.isIdle ? (
        <View testID="tonight-make-searching" className="items-center gap-2 py-8">
          <NomadLoader testID="tonight-make-searching-loader" accessibilityLabel={tMake('searching')} style={{ width: 240 }} />
          <Text>{tMake('searching')}</Text>
          <Text variant="muted">{tMake('searchingHint')}</Text>
        </View>
      ) : searchErr ? (
        <View className="items-start gap-2">
          <Text testID="tonight-make-search-error" variant="error">
            {tAll(searchErr.key, searchErr.values)}
          </Text>
          <Button testID="tonight-make-retry" label={t('retry')} variant="secondary" onPress={search.run} />
        </View>
      ) : (
        <>
          {locked ? (
            <View testID="match-gate-checking" className="flex-row items-center gap-2">
              <ActivityIndicator size="small" />
              <Text variant="muted">{tMake('matchChecking')}</Text>
            </View>
          ) : null}
          {noResults ? <Text testID="make-no-results">{tMake('noResults')}</Text> : null}
          {linkFirst ? linkBox : null}
          {best && confidence ? (
            <>
              <PickCard
                result={best}
                tier={confidence.tier}
                confidence={confidence}
                songTitle={song.title}
                selected={!useLink && selectedIndex === best.index}
                disabled={locked || sending}
                onPress={() => choose(best.index)}
              />
              {others.length > 0 ? (
                <Pressable
                  testID="make-other-sources"
                  accessibilityRole="button"
                  onPress={() => setShowOthers((v) => !v)}
                  className="min-h-11 justify-center self-start"
                >
                  <Text className="text-primary">
                    {showOthers ? tMake('hideOtherSources') : tMake('seeOtherSources', { count: others.length })}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : results.length > 0 ? (
            <Text>{tMake('notSure')}</Text>
          ) : null}
          {results.length > 0 && (!best || showOthers) ? (
            <SourceGroups
              results={others}
              searchTitle={song.title}
              expandAll={confidence?.tier === 3}
              selectedIndex={useLink ? null : selectedIndex}
              disabled={locked || sending}
              onSelect={choose}
            />
          ) : null}
          {linkFirst ? null : (
            <>
              <Pressable
                testID="youtube-toggle"
                accessibilityRole="button"
                onPress={() => setYoutubeOpen((v) => !v)}
                className="min-h-11 justify-center self-start"
              >
                <Text className="text-primary">{tMake('youtubeFallbackToggle')}</Text>
              </Pressable>
              {youtubeOpen ? linkBox : null}
            </>
          )}

          <View testID="tonight-make-eta-box" className="gap-1 rounded-xl border border-border bg-card p-3">
            <Text testID="tonight-make-eta">{t('eta')}</Text>
            <Text variant="muted">{t('etaRotation')}</Text>
          </View>
          {waiting ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" />
              <Text testID="tonight-make-still-working" variant="muted">
                {t('stillWorking')}
              </Text>
            </View>
          ) : null}
          {error ? (
            <Text testID="tonight-make-error" variant="error">
              {error}
            </Text>
          ) : null}
          <Button
            testID="tonight-make-submit"
            label={t('submit')}
            onPress={() => void send()}
            disabled={!target || locked || sending}
            loading={sending}
          />
        </>
      )}
    </Screen>
  );
}
