import { getMe as getGenMe, type AudioResult } from '@nomad/api-gen';
import { getMe, getNight, KjboxError, makeValidateUrl, submitRequest, type MeResult, type Night } from '@nomad/api-kjbox';
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
import { track } from '../../observability';
import { consentFields, loadNightConsent, serverNightConsent } from '../manage/NightConsent';
import { storedPhone } from '../manage/PhoneSheet';
import { useNightStore, type NomadNight } from '../nightStore';
import { nightKey } from '../nomad/queries';
import { NIGHT_ROUTE } from '../request/ConfirmScreen';
import { errorCopy } from '../request/errorCopy';
import { newRequestId, useRequestStore } from '../request/requestStore';
import { kjboxJudge, kjboxSearcher } from './kjboxMake';
import { clearPendingMake, findMakeRow, getPendingMake, sameSource, setPendingMake, type PendingMake } from './pendingMake';
import { MakeStillPending, retryable, sendMake } from './sendMake';

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

/** This screen's own path with its params (sign-in returns here). */
export function makeHref({ artist, title, friend }: TonightMakeProps): string {
  const q = [`artist=${encodeURIComponent(artist)}`, `title=${encodeURIComponent(title)}`];
  if (friend) q.push(`friend=${encodeURIComponent(friend)}`);
  return `/tonight/make?${q.join('&')}`;
}

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
      <Screen underHeader testID="tonight-make-screen">
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
      <Screen underHeader testID="tonight-make-screen">
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
    body = <Button testID="tonight-make-signin" label={tAll('account.signIn')} onPress={() => openSignIn(makeHref(props))} />;
  } else {
    return <MakeFlow {...props} />;
  }
  return (
    <Screen underHeader testID="tonight-make-screen" scroll>
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
  if (song) return <PendingGate {...props} song={song} />;
  const ready = draft.artist.trim() !== '' && draft.title.trim() !== '';
  return (
    <Screen underHeader testID="tonight-make-screen" scroll>
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

type SourceMeta = PendingMake['sourceMeta'];
type Wanted = { artist: string; title: string; friend?: string };
type SendArgs = { clientRequestId: string; sourceMeta: SourceMeta; artist: string; title: string };

/**
 * The make submit (shared by a fresh make and a resumed one). The send is recorded as pending (per account + night,
 * keyed on the song asked for) before it goes out, so leaving mid-send never loses its client_request_id; the record
 * is cleared once the outcome is clear. Success: invalidate the night and go back to Tonight (ruling E7-R3).
 */
function useMakeSend(night: NomadNight, userKey: string | null, wanted: Wanted) {
  const t = useTranslations('tonight.make');
  const tAll = useTranslations();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askHost, setAskHost] = useState(false);
  // A ref, not just `disabled`: two taps in one frame still send once (Review Focus 3).
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Resolves 'expired' when the box says the search session expired (409 conflict on a search pick), else void. */
  const send = async (a: SendArgs): Promise<'expired' | void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setWaiting(false);
    setError(null);
    const { friend } = wanted;
    setPendingMake(userKey, night.nightId, wanted, {
      clientRequestId: a.clientRequestId,
      sourceMeta: a.sourceMeta,
      songArtist: a.artist,
      songTitle: a.title,
      at: Date.now(),
    });
    const phone = friend ? null : storedPhone(userKey);
    const body = {
      source_type: 'make' as const,
      song_artist: a.artist,
      song_title: a.title,
      source_meta: a.sourceMeta,
      night_id: night.nightId,
      client_request_id: a.clientRequestId,
      ...(friend ? { for_friend: true, friend_name: friend } : {}),
      ...(phone ? { phone } : {}),
      // The night's photo answer, only ever given when the host asked (A.91); never on a friend's song. The box's own
      // answer (/me) wins over this device's.
      ...(friend ? {} : consentFields(loadNightConsent(userKey, night.nightId), serverNightConsent(queryClient, night, userKey))),
    };
    try {
      await sendMake(() => submitRequest(night.code, body), {
        onWaiting: () => setWaiting(true),
        alive: () => alive.current,
      });
      clearPendingMake(userKey, night.nightId, wanted);
      track('song_requested', { mode: 'make' });
      void queryClient.invalidateQueries({ queryKey: nightKey(night, userKey) });
      if (alive.current) router.dismissTo(NIGHT_ROUTE);
    } catch (e) {
      // Unknown outcome (it may have landed): keep the record, so making this song again reuses the same id.
      const unknown = e instanceof MakeStillPending || retryable(e) || !(e instanceof KjboxError) || e.code === 'internal';
      if (!unknown) clearPendingMake(userKey, night.nightId, wanted);
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
      // kjbox sing_make.create_job turns gen's 404/403 on the search session into web 409 {error: 'search_expired'};
      // v1's map_web_error has no entry for it, so it answers 409 `conflict` with message 'search_expired'.
      if (e instanceof KjboxError && e.code === 'conflict' && e.body.message === 'search_expired') return 'expired';
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

  return { send, sending, waiting, error, setError, askHost, inFlight };
}

function SendStatus({ waiting, error }: { waiting: boolean; error: string | null }) {
  const t = useTranslations('tonight.make');
  return (
    <>
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
    </>
  );
}

/**
 * Before searching: an earlier make of this song whose outcome is unknown (fix round 1). If /me shows its make-it
 * row, it landed: say so and forget the record. Otherwise offer to send it again with the same client_request_id and
 * source (the box replays it for 24 h), never a fresh search that would mint a new id and maybe a second gen job.
 */
function PendingGate(props: TonightMakeProps & { night: NomadNight; userKey: string | null; song: Song }) {
  const { night, userKey, friend, song } = props;
  const wanted = useMemo(() => ({ ...song, ...(friend ? { friend } : {}) }), [song, friend]);
  const [pending, setPending] = useState(() => getPendingMake(userKey, night.nightId, wanted));
  if (!pending) return <MakeSearch {...props} wanted={wanted} />;
  return <ResumeMake night={night} userKey={userKey} wanted={wanted} pending={pending} onFresh={() => setPending(null)} />;
}

function ResumeMake({
  night,
  userKey,
  wanted,
  pending,
  onFresh,
}: {
  night: NomadNight;
  userKey: string | null;
  wanted: Wanted;
  pending: PendingMake;
  onFresh: () => void;
}) {
  const t = useTranslations('tonight.make');
  const me = useQuery<MeResult>({
    queryKey: [...nightKey(night, userKey), 'me'],
    queryFn: () => getMe(night.code, night.nightId),
    staleTime: 0,
    retry: false,
  });
  const row = me.data ? findMakeRow(me.data.songs, wanted, pending) : null;
  useEffect(() => {
    if (row) clearPendingMake(userKey, night.nightId, wanted);
  }, [row, userKey, night.nightId, wanted]);
  const s = useMakeSend(night, userKey, wanted);

  let body;
  if (me.isPending) {
    body = (
      <View testID="tonight-make-checking" className="items-center py-8">
        <ActivityIndicator />
      </View>
    );
  } else if (row) {
    body = (
      <View className="gap-3">
        <Text testID="tonight-make-already">{t('alreadyOnItsWay', { title: isolate(pending.songTitle) })}</Text>
        <Button testID="tonight-make-already-back" label={t('backToSongs')} onPress={() => router.dismissTo(NIGHT_ROUTE)} />
      </View>
    );
  } else if (s.askHost) {
    body = <AskHost />;
  } else {
    body = (
      <View className="gap-3">
        <Text testID="tonight-make-resume-hint">{t('resumeHint', { title: isolate(pending.songTitle) })}</Text>
        <SendStatus waiting={s.waiting} error={s.error} />
        <Button
          testID="tonight-make-resume"
          label={t('resume')}
          loading={s.sending}
          disabled={s.sending}
          onPress={() =>
            void s
              .send({ clientRequestId: pending.clientRequestId, sourceMeta: pending.sourceMeta, artist: pending.songArtist, title: pending.songTitle })
              .then((r) => {
                // The stored search expired before anything was made: nothing landed, so a fresh search is safe.
                if (r === 'expired') onFresh();
              })
          }
        />
      </View>
    );
  }
  return (
    <Screen underHeader testID="tonight-make-screen" scroll>
      <View className="gap-1">
        <Text testID="tonight-make-song-title" variant="title">
          {pending.songTitle}
        </Text>
        <Text variant="muted">{pending.songArtist}</Text>
        {wanted.friend ? <FriendLine name={wanted.friend} /> : null}
      </View>
      {body}
    </Screen>
  );
}

function MakeSearch({ night, userKey, friend, wanted }: TonightMakeProps & { night: NomadNight; userKey: string | null; wanted: Wanted }) {
  const t = useTranslations('tonight.make');
  const tMake = useTranslations('make');
  const tAll = useTranslations();

  // A typed intent with no pre-fill to protect: the judge may tidy or correct either field (useMatchJudge).
  const [intent] = useState<MakeIntent>(() => ({
    artist: wanted.artist,
    title: wanted.title,
    source: 'typed',
    editedFields: [],
    createdAt: Date.now(),
  }));
  const searcher = useMemo(() => kjboxSearcher(night), [night]);
  const judgeFn = useMemo(() => kjboxJudge(night), [night]);

  const [picked, setPicked] = useState<number | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [checkingLink, setCheckingLink] = useState(false);
  const [searchedAgain, setSearchedAgain] = useState(false);
  const sender = useMakeSend(night, userKey, wanted);
  const { sending: submitting, waiting, error, askHost, inFlight } = sender;
  const sending = submitting || checkingLink;

  const search = useAudioSearch(intent, searcher);
  const results: AudioResult[] = useMemo(() => search.data?.results ?? [], [search.data]);
  const searched = search.variables;
  const searchTier = useMemo(
    () => (search.isSuccess && searched ? getSearchConfidence(results, searched.title, searched.artist).tier : null),
    [search.isSuccess, searched, results],
  );
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
  const song = useMemo(() => judge.applied ?? { artist: wanted.artist, title: wanted.title }, [judge.applied, wanted]);
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

  // One client_request_id per asked-for song + source pick (never the judge's names: undo/redo mustn't mint a new
  // id while a send may be pending), and always the pending record's while one exists for this song.
  const requestId = useRef<{ sig: string; id: string } | null>(null);
  const expiredOnce = useRef(false);
  const searchAgain = () => {
    setPicked(null);
    setSearchedAgain(true);
    search.run();
  };

  const send = async () => {
    if (!target || locked || inFlight.current || checkingLink) return;
    sender.setError(null);
    if (target.kind === 'source' && !target.sessionId) {
      // No search session to send (the box's search came back without one): search again first.
      searchAgain();
      return;
    }
    if (target.kind === 'url') {
      // Like gen's "Use this URL": ask first, so an unsupported link fails here. Fails open (the box checks again).
      setCheckingLink(true);
      try {
        const check = await makeValidateUrl(night.code, target.url, night.nightId);
        if (!check.supported) {
          const detail = typeof check.detail === 'string' ? check.detail : '';
          setLinkError(detail || tMake('linkUnsupported'));
          return;
        }
      } catch {
        // fail open
      } finally {
        setCheckingLink(false);
      }
    }
    const sourceMeta: SourceMeta =
      target.kind === 'url' ? { youtube_url: target.url } : { search_session_id: target.sessionId, selection_index: target.index };
    const pick = target.kind === 'url' ? target.url : `${target.sessionId}#${target.index}`;
    const sig = JSON.stringify([wanted.artist, wanted.title, friend ?? null, pick]);
    const prior = getPendingMake(userKey, night.nightId, wanted);
    // Reuse the pending id only for the same source: a different pick is a different request (a new id; if the
    // first one did land, the singer sees both in Your songs and can cancel one).
    if (prior && sameSource(prior.sourceMeta, sourceMeta)) requestId.current = { sig, id: prior.clientRequestId };
    else if (requestId.current?.sig !== sig) requestId.current = { sig, id: newRequestId() };
    const r = await sender.send({ clientRequestId: requestId.current.id, sourceMeta, artist: song.artist, title: song.title });
    if (r === 'expired') {
      if (!expiredOnce.current) {
        expiredOnce.current = true;
        searchAgain();
      } else {
        sender.setError(tAll(errorCopy(new KjboxError('conflict', 409)).key));
      }
    }
  };

  if (askHost || searchDisabled) {
    return (
      <Screen underHeader testID="tonight-make-screen" scroll>
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
    <Screen underHeader testID="tonight-make-screen" scroll>
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
          {searchedAgain ? (
            <Text testID="tonight-make-searched-again" variant="muted">
              {tMake('searchExpired')}
            </Text>
          ) : null}
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
          <SendStatus waiting={waiting} error={error} />
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
