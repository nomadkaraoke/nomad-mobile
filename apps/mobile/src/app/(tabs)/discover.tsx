import {
  resolveQuery,
  type ResolveResponse,
  type SongGroup,
  type SongRef,
} from "@nomad/api-decide";
import { useTranslations } from "@nomad/i18n";
import { Button, List, Screen, Text, TextField } from "@nomad/ui";
import { router, useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  View,
} from "react-native";

import { openSignIn } from "../../auth/signInUi";
import { useAuth } from "../../auth/store";
import { MakeBar } from "../../find/components/MakeBar";
import { MissingCard } from "../../find/components/MissingCard";
import { OfflineBanner } from "../../find/components/OfflineBanner";
import { SimilarList } from "../../find/components/SimilarList";
import { SongCard } from "../../find/components/SongCard";
import { VersionList } from "../../find/components/VersionList";
import { WhichOne } from "../../find/components/WhichOne";
import {
  describeOutcome,
  makeOfferWhere,
  NO_CHOICE,
  searchOutcome,
  type Choice,
  type Outcome,
} from "../../find/outcome";
import { currentSid, logEvent, renewSid } from "../../find/searchSession";
import { MIN_QUERY_CHARS, useSearch } from "../../find/useSearch";
import { useTapGuard } from "../../find/useTapGuard";
import {
  identifiedIntent,
  useMakeIntent,
  type SongIdentity,
} from "../../make/intentStore";
import { useOfflineIndex } from "../../offline/offlineIndex";

/** A popular-list row (empty search box). */
function SongRow({
  song,
  index,
  onOpen,
}: {
  song: SongGroup;
  index: number;
  onOpen: (s: SongGroup) => void;
}) {
  const t = useTranslations("find");
  return (
    <Pressable
      testID={`song-row-${index}`}
      accessibilityRole="button"
      onPress={() => onOpen(song)}
      className="border-b border-border py-3"
    >
      <Text className="font-semibold">{song.title}</Text>
      <Text variant="muted">{song.artist}</Text>
      <Text
        variant="muted"
        className={song.version_count > 0 ? "text-gold" : ""}
      >
        {t("karaokeVersions", { count: song.version_count })}
      </Text>
    </Pressable>
  );
}

/** `also`: the other song_keys the card merged with this one, so the song page lists the same versions. */
const openSong = (songKey: string, also: string[] = []) => {
  Keyboard.dismiss();
  renewSid(); // a pick ends the search session
  const extra = also.filter((k) => k !== songKey);
  router.push({
    pathname: "/song/[id]",
    params: extra.length ? { id: songKey, also: JSON.stringify(extra) } : { id: songKey },
  });
};

/** The missing card's Make it: exactly the identified artist/title (spec §4.1 outcome 2), then sign-in or make. */
const makeIdentified = (song: SongRef, signedIn: boolean) => {
  logEvent("make_offer_tap", {
    where: "missing_card",
    song_key: song.song_key,
  });
  renewSid();
  Keyboard.dismiss();
  useMakeIntent.getState().set(identifiedIntent(song));
  if (signedIn) router.push("/make/new");
  else openSignIn("/make/new");
};

const openMakeAny = () => {
  Keyboard.dismiss();
  router.push({ pathname: "/song/[id]", params: { id: "new" } });
};

type Describe = {
  open: boolean;
  text: string;
  loading: boolean;
  result: ResolveResponse | null;
  submitted: string;
  failed: boolean;
  /** The describe request itself couldn't reach decide (network / 5xx): not "we couldn't work out the song". */
  unreachable: boolean;
};
const DESCRIBE_CLOSED: Describe = {
  open: false,
  text: "",
  loading: false,
  result: null,
  submitted: "",
  failed: false,
  unreachable: false,
};

export default function DiscoverScreen() {
  const t = useTranslations();
  const [query, setQuery] = useState("");
  const search = useSearch(query);
  const offlineIndex = useOfflineIndex();
  const signedIn = useAuth((s) => s.state.status === "signedIn");
  const insets = useSafeAreaInsets();
  const popular = search.query.length < MIN_QUERY_CHARS;
  // The identification, groups and resolve answer the current query (never the previous query's card).
  const fresh = search.resultsQuery === search.query;

  // Choices (Undo, Not it?, a picked chip) belong to the answer they were made on.
  const [choiceState, setChoiceState] = useState<{
    key: string;
    choice: Choice;
  }>({ key: "", choice: NO_CHOICE });
  const [describe, setDescribe] = useState<Describe>(DESCRIBE_CLOSED);
  const describing = describe.result !== null && describe.submitted !== "";
  const answerSource = describing ? "describe" : "search";
  const answerQuery = describing ? describe.submitted : search.query;
  const answerKey = `${answerSource}:${answerQuery}`;
  // Only the latest describe request may land: typing in the search box or submitting again bumps it.
  const describeRequest = useRef(0);
  useEffect(
    () => () => {
      describeRequest.current = -1; // unmounted: drop any answer still in flight
    },
    [],
  );
  const choice = choiceState.key === answerKey ? choiceState.choice : NO_CHOICE;
  const choose = (patch: Partial<Choice>) =>
    setChoiceState({ key: answerKey, choice: { ...choice, ...patch } });

  const describeResult = describing
    ? describeOutcome(describe.result!, describe.submitted, choice)
    : null;
  const outcome: Outcome | null = describing
    ? describeResult
    : !popular && fresh
      ? searchOutcome(
          search.identification,
          search.groups,
          search.resolve,
          search.query,
          choice,
        )
      : null;

  // The Gemini resolve is running for a query the cloud found nothing for.
  const figuringOut =
    !describing &&
    fresh &&
    search.loading &&
    search.source === "cloud" &&
    search.groups.length === 0 &&
    search.identification?.status === "none";
  // "No songs found" only for a real, empty answer: when search couldn't run (nothing to show, or an error
  // banner is up) the empty list is not a result.
  const noResultsAreReal =
    describing || (search.source !== "none" && search.error === null);
  const where = outcome && !figuringOut ? makeOfferWhere(outcome) : null;
  const guard = useTapGuard(
    `${answerKey}|${search.source}|${fresh}|${outcome?.kind ?? ""}|${search.groups.map((g) => g.song_key).join(",")}`,
  );

  // "Make any song" starts from the song this answer identified (kjbox prefillMake, spec §4.3): the card's
  // song, else the resolve's artist/title split; a new query with none empties every field the user hasn't
  // edited. Edited fields are never touched.
  const resolveSplit = describing ? describe.result?.split : search.resolve?.split;
  const prefillFrom: SongIdentity | null =
    outcome?.kind === "song" || outcome?.kind === "missing"
      ? outcome.song
      : resolveSplit
        ? { artist: resolveSplit.artist, title: resolveSplit.title }
        : null;
  // Only once this screen has an answer (or the popular list); primitive deps so a re-render never re-fills.
  const prefillActive = (popular && !describing) || outcome !== null;
  const prefillArtist = prefillFrom?.artist ?? null;
  const prefillTitle = prefillFrom?.title ?? "";
  const prefillSongKey = prefillFrom?.song_key;
  useEffect(() => {
    if (!prefillActive) return;
    useMakeIntent.getState().prefill(
      prefillArtist === null
        ? null
        : {
            artist: prefillArtist,
            title: prefillTitle,
            ...(prefillSongKey ? { song_key: prefillSongKey } : {}),
          },
    );
  }, [prefillActive, prefillArtist, prefillTitle, prefillSongKey]);

  // Every make offer shown is logged once per answer (spec §5.6, kjbox D11).
  useEffect(() => {
    if (where)
      logEvent("make_offer_shown", {
        where,
        source: answerSource,
        q: answerQuery,
      });
  }, [where, answerSource, answerQuery]);

  // The search field never takes focus by itself: on Android a resumed activity can hand focus back to
  // it (or a sheet can leave the keyboard up), covering the tab bar. Focus only on the user's tap.
  // Only while Discover is on screen: with the sign-in code screen on top, coming back from the mail
  // app must keep the code field focused.
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    Keyboard.dismiss();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") Keyboard.dismiss();
    });
    return () => sub?.remove(); // jest-expo's AppState mock returns no subscription
  }, [focused]);

  const onQuery = (text: string) => {
    setQuery(text);
    describeRequest.current += 1;
    if (describe.result || describe.failed || describe.unreachable || describe.loading) {
      setDescribe((d) => ({
        ...d,
        loading: false,
        result: null,
        submitted: "",
        failed: false,
        unreachable: false,
      }));
    }
  };

  const makeFromBar = () => {
    logEvent("make_offer_tap", { where: "make_bar" });
    openMakeAny();
  };

  const submitDescribe = () => {
    const text = describe.text.trim();
    if (!text) return;
    Keyboard.dismiss();
    logEvent("describe_submit", { chars: text.length });
    const request = ++describeRequest.current;
    const current = () => describeRequest.current === request;
    setDescribe((d) => ({ ...d, loading: true, failed: false, unreachable: false }));
    resolveQuery(text, currentSid()).then(
      (result) => {
        if (!current()) return;
        // An answer with no outcome is a failure: keep result/submitted empty so the screen isn't "describing" nothing.
        const nothing = describeOutcome(result, text, NO_CHOICE) === null;
        setDescribe((d) => ({
          ...d,
          loading: false,
          result: nothing ? null : result,
          submitted: nothing ? "" : text,
          failed: nothing,
          unreachable: false,
        }));
      },
      (e: unknown) => {
        if (!current()) return;
        // A 4xx is decide refusing this description; anything else (network, 5xx) means it never answered.
        const status = (e as { status?: unknown } | null)?.status;
        const refused = typeof status === "number" && status >= 400 && status < 500;
        setDescribe((d) => ({
          ...d,
          loading: false,
          result: null,
          submitted: "",
          failed: refused,
          unreachable: !refused,
        }));
      },
    );
  };

  const renderOutcome = (o: Outcome) => {
    switch (o.kind) {
      case "song":
        return (
          <>
            <SongCard
              song={o.song}
              announce={o.announce}
              onOpen={guard(() => openSong(o.song.song_key, o.keys))}
              onUndo={guard(() => {
                logEvent("keep_typed", { song_key: o.song.song_key });
                choose({ keepTyped: true });
              })}
              onNotIt={
                o.canNotIt
                  ? guard(() => {
                      logEvent("not_it", { song_key: o.song.song_key });
                      choose({ notIt: true, picked: null });
                    })
                  : undefined
              }
            />
            {o.group && o.group.versions.length > 0 ? (
              <VersionList
                key={o.group.song_key}
                versions={o.group.versions}
                total={o.group.version_count}
                onShowAll={guard(() => openSong(o.song.song_key, o.keys))}
                openUrl={guard((url: string) => {
                  logEvent("open_youtube", { song_key: o.song.song_key });
                  Linking.openURL(url).catch(() => {});
                })}
              />
            ) : null}
            <SimilarList
              groups={o.others}
              heading="similar"
              cap={3}
              onOpen={guard((g: SongGroup) => openSong(g.song_key))}
            />
          </>
        );
      case "missing":
        return (
          <>
            <MissingCard
              song={o.song}
              offline={search.offline}
              onMake={guard(() => makeIdentified(o.song, signedIn))}
            />
            <SimilarList
              groups={o.others}
              heading="similar"
              cap={3}
              onOpen={guard((g: SongGroup) => openSong(g.song_key))}
            />
          </>
        );
      case "choose":
        return (
          <>
            <WhichOne
              heading={o.heading}
              candidates={o.candidates}
              onPick={guard((i: number) => {
                logEvent("pick_candidate", {
                  i,
                  song_key: o.candidates[i]?.song_key,
                });
                choose({ picked: i });
              })}
            />
            <SimilarList
              groups={o.groups}
              heading="results"
              cap={null}
              onOpen={guard((g: SongGroup) => openSong(g.song_key))}
            />
          </>
        );
      case "list":
        return o.groups.length > 0 ? (
          <SimilarList
            groups={o.groups}
            heading="results"
            cap={null}
            onOpen={guard((g: SongGroup) => openSong(g.song_key))}
          />
        ) : noResultsAreReal ? (
          <Text variant="muted">
            {t("find.noResults", {
              query: describing ? describe.submitted : search.query,
            })}
          </Text>
        ) : null;
    }
  };

  const status = (
    <>
      {search.warmingUp ? (
        <Text variant="muted" testID="discover-warming">
          {t("discover.warmingUp")}
        </Text>
      ) : null}
      {search.error ? (
        <View className="items-start gap-2">
          <Text variant="error">
            {search.error === "rejected"
              ? t("discover.rejected")
              : t("discover.unreachable")}
          </Text>
          <Button
            testID="discover-retry"
            label={t("common.retry")}
            variant="secondary"
            onPress={search.retry}
          />
        </View>
      ) : null}
    </>
  );

  return (
    <Screen testID="discover-screen">
      {search.offline ? (
        <OfflineBanner
          status={offlineIndex.status}
          downloadedAt={offlineIndex.downloadedAt}
          onDownload={() => void offlineIndex.download()}
        />
      ) : null}
      <View className="gap-1">
        <TextField
          testID="discover-search-input"
          label={t("find.searchPlaceholder")}
          placeholder={t("find.searchPlaceholder")}
          value={query}
          onChangeText={onQuery}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {describe.open ? (
          <View className="gap-2 pt-2">
            <TextField
              testID="describe-input"
              label={t("discover.describeLabel")}
              placeholder={t("discover.describePlaceholder")}
              value={describe.text}
              onChangeText={(text) => setDescribe((d) => ({ ...d, text }))}
              returnKeyType="search"
              onSubmitEditing={submitDescribe}
            />
            <Button
              testID="describe-submit"
              label={t("discover.describeSubmit")}
              onPress={submitDescribe}
              loading={describe.loading}
              disabled={describe.text.trim() === ""}
            />
          </View>
        ) : (
          <Pressable
            testID="describe-link"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setDescribe((d) => ({ ...d, open: true }))}
          >
            <Text className="text-sm text-primary">
              {t("discover.describeLink")}
            </Text>
          </Pressable>
        )}
      </View>
      {describe.loading ? (
        <Text variant="muted" testID="discover-figuring-out">
          {t("discover.figuringOut")}
        </Text>
      ) : describe.failed ? (
        <Text variant="muted" testID="describe-nothing">
          {t("discover.describeNothing")}
        </Text>
      ) : describe.unreachable ? (
        <Text variant="error" testID="describe-unreachable">
          {search.offline
            ? t("discover.needsConnection")
            : t("discover.unreachable")}
        </Text>
      ) : null}
      {/* The sticky make bar rides above the keyboard. Both platforms pad: Android is edge-to-edge (SDK 57,
          API 35), so adjustResize no longer shrinks the window and the bar sat under the keyboard. It stays
          mounted across popular ↔ results: a KAV mounted while the keyboard is already up never hears the
          keyboard event, so it wouldn't pad. KAV measures its frame relative to its parent (Screen's content,
          which starts at the top inset); the offset turns that into window coordinates. */}
      <KeyboardAvoidingView
        style={{ flex: 1, gap: 12 }}
        behavior="padding"
        keyboardVerticalOffset={insets.top}
      >
        {popular && !describing ? (
          <>
            {status}
            {search.error ? null : (
              <Text variant="title">{t("find.popularHeading")}</Text>
            )}
            <View className="flex-1">
              <List
                testID="discover-list"
                data={fresh ? search.groups : []}
                keyExtractor={(s) => s.song_key}
                renderItem={(s, i) => (
                  <SongRow
                    song={s}
                    index={i}
                    onOpen={guard((g: SongGroup) => openSong(g.song_key))}
                  />
                )}
                ListEmptyComponent={
                  search.loading ? (
                    <ActivityIndicator testID="discover-loading" />
                  ) : undefined
                }
                ListFooterComponent={
                  <View className="py-4">
                    <Button
                      testID="discover-make-any"
                      label={t("find.makeAnySong")}
                      variant="secondary"
                      onPress={openMakeAny}
                    />
                  </View>
                }
              />
            </View>
          </>
        ) : (
          <>
            <ScrollView
              testID="discover-results"
              className="flex-1"
              contentContainerClassName="gap-3 pb-4"
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {status}
              {figuringOut ? (
                <Text variant="muted" testID="discover-figuring-out">
                  {t("discover.figuringOut")}
                </Text>
              ) : outcome ? (
                renderOutcome(outcome)
              ) : (
                <>
                  {/* A new query's first answer hasn't landed: the previous rows stay (no card) under a spinner. */}
                  {search.loading ? (
                    <ActivityIndicator testID="discover-loading" />
                  ) : null}
                  {(search.resultsQuery?.length ?? 0) >= MIN_QUERY_CHARS ? (
                    <View className="opacity-50" pointerEvents="none">
                      <SimilarList
                        groups={search.groups}
                        heading="results"
                        cap={null}
                        onOpen={() => {}}
                      />
                    </View>
                  ) : null}
                </>
              )}
            </ScrollView>
            {where === "make_bar" ? (
              <MakeBar offline={search.offline} onMake={guard(makeFromBar)} />
            ) : null}
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
