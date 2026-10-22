import { logSearchEvent, type ArtistTitle, type SearchSong, type SearchVersion } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, colors, Text, TextField } from '@nomad/ui';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useNightStore } from '../nightStore';
import { CorrectionBanner } from './CorrectionBanner';
import { errorCopy } from './errorCopy';
import { MakeBar } from './MakeBar';
import { NoKaraokeCard } from './NoKaraokeCard';
import { defaultChoice, useRequestFlowScope, useRequestStore } from './requestStore';
import { ResultsList } from './ResultsList';
import { confidentSong, KJBOX_MIN_QUERY, showMakeBar, songMissing, useKjboxSearch } from './useKjboxSearch';
import { useListArm } from './useListArm';
import { VersionInfoSheet } from './VersionInfoSheet';

/** Near-misses under a no-karaoke card (A.31). */
export const SIMILAR_CAP = 3;

/** The make-it route E7 implements (ruling E5-R7): search only navigates there with the artist and title. */
export const MAKE_ROUTE = '/tonight/make';

export type SearchScreenProps = {
  /** Route params: change mode (A.39) or a song for a friend (A.10). */
  change?: { id: number; title: string };
  friend?: string;
};

type Where = 'missing_card' | 'sticky_bar' | 'empty';

/** Tonight's request search (spec §4.1 Search, Versions, Auto-correct, No karaoke version). */
export function SearchScreen({ change, friend }: SearchScreenProps) {
  const t = useTranslations('tonight.request');
  const tAll = useTranslations();
  const night = useNightStore((s) => s.active);
  const code = night?.kind === 'nomad' ? night.code : null;
  const nightId = night?.kind === 'nomad' ? night.nightId : undefined;
  useRequestFlowScope();
  const mode = useRequestStore((s) => s.mode);
  const replaces = useRequestStore((s) => s.replaces);

  // The route params set the flow once, when the screen opens.
  const changeId = change?.id;
  const changeTitle = change?.title;
  useEffect(() => {
    const store = useRequestStore.getState();
    if (changeId !== undefined) store.startChange({ id: changeId, title: changeTitle ?? '' });
    else if (friend) store.startFriend(friend);
    else store.clear();
  }, [changeId, changeTitle, friend]);

  const [q, setQ] = useState('');
  const s = useKjboxSearch(q);
  const arm = useListArm();
  const [info, setInfo] = useState<SearchVersion | null>(null);

  const settled = s.resultsQuery === s.query && s.query.length >= KJBOX_MIN_QUERY;
  const missing = settled && songMissing(s);
  const bar = settled && !missing && showMakeBar(s);
  const offerMake = s.makeEnabled && !s.simpleMode && mode !== 'change';
  const empty = settled && !s.loading && !s.resolving && !s.error && s.shown.length === 0 && !missing;
  const missingSong = missing ? confidentSong(s) : null;

  const log = (action: string, data?: Record<string, unknown>) => {
    if (code) void logSearchEvent(code, { sid: s.sid, action, q: s.query, night_id: nightId, ...(data ? { data } : {}) });
  };

  // make_offer_shown once per query and placement (A.32: offers logged by placement).
  const loggedShown = useRef(new Set<string>());
  const shownWhere: Where | null = !offerMake ? null : missing ? 'missing_card' : bar ? 'sticky_bar' : empty ? 'empty' : null;
  useEffect(() => {
    if (!shownWhere) return;
    const k = `${s.query}\u0000${shownWhere}`;
    if (loggedShown.current.has(k)) return;
    loggedShown.current.add(k);
    log('make_offer_shown', { where: shownWhere });
  });

  const makePrefill = (): ArtistTitle => {
    const song = confidentSong(s);
    if (song) return { artist: song.artist, title: song.title };
    if (s.correction && !s.undone) return s.correction.corrected;
    return { artist: '', title: s.query };
  };
  const make = (where: Where) => {
    log('make_offer_tap', { where });
    const { artist, title } = makePrefill();
    router.push({ pathname: MAKE_ROUTE as never, params: { artist, title } });
  };

  const choose = (song: SearchSong, version: SearchVersion | 'auto') => {
    useRequestStore.getState().pick(song, version, s.query);
    log('request_song', { song: `${song.title} — ${song.artist}`, source_type: version === 'auto' ? 'kj_pick' : version.source });
    router.push('/tonight/confirm');
  };

  const err = s.error ? errorCopy(s.error) : null;

  return (
    <SafeAreaView testID="tonight-search" style={{ flex: 1, backgroundColor: colors.bg }} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerClassName="gap-3 p-4 pb-24" keyboardShouldPersistTaps="handled">
        {mode === 'change' && replaces ? (
          <View testID="tonight-replacing" className="gap-1 rounded-xl border border-gold/40 bg-gold/10 p-3">
            <Text className="font-semibold">{t('replacing', { title: isolate(replaces.title) })}</Text>
            <Text variant="muted">{t('replacingHint')}</Text>
            <Pressable testID="tonight-replacing-keep" accessibilityRole="button" hitSlop={8} onPress={() => router.back()}>
              <Text className="text-sm font-semibold text-primary">{t('keepSong')}</Text>
            </Pressable>
          </View>
        ) : null}
        <TextField
          testID="tonight-search-input"
          label={t('searchLabel')}
          placeholder={t('placeholder')}
          value={q}
          onChangeText={setQ}
          autoFocus
          autoCapitalize="none"
          returnKeyType="search"
        />
        {q.trim().length > 0 && q.trim().length < KJBOX_MIN_QUERY ? (
          <Text variant="muted">{t('minChars')}</Text>
        ) : null}
        {s.loading ? (
          <View testID="tonight-searching" className="flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text variant="muted">{t('searching')}</Text>
          </View>
        ) : null}
        {err ? (
          <View testID="tonight-search-error" className="gap-2">
            <Text variant="error">{tAll(err.key, err.values)}</Text>
            <Button testID="tonight-search-retry" variant="secondary" label={t('retry')} onPress={s.retry} />
          </View>
        ) : null}
        {settled ? (
          <CorrectionBanner
            resolving={s.resolving}
            correction={s.correction}
            undone={s.undone}
            onUndo={s.undo}
            onRedo={s.redo}
            alternatives={s.alternatives}
            onAlternative={(a) => setQ(`${a.artist} ${a.title}`)}
          />
        ) : null}
        {missingSong ? <NoKaraokeCard song={missingSong} offerMake={offerMake} onMake={() => make('missing_card')} /> : null}
        {empty ? (
          <View testID="tonight-empty" className="gap-2">
            <Text className="font-semibold">{t('emptyTitle')}</Text>
            {offerMake ? (
              <Button testID="tonight-empty-make" label={t('emptyMake')} onPress={() => make('empty')} />
            ) : (
              <Text testID="tonight-ask-host" variant="muted">
                {s.simpleMode ? t('emptySimple') : t('askHost')}
              </Text>
            )}
          </View>
        ) : null}
        {s.shown.length > 0 ? (
          <ResultsList
            songs={s.shown}
            arm={arm}
            simpleMode={s.simpleMode}
            cap={missing ? SIMILAR_CAP : null}
            heading={missing ? t('similarHeading') : undefined}
            onRequest={(song) => choose(song, defaultChoice(song))}
            onPickVersion={(song, v) => choose(song, v)}
            onInfo={setInfo}
          />
        ) : null}
      </ScrollView>
      {bar && offerMake ? (
        <View className="absolute bottom-4 left-4 right-4">
          <MakeBar onMake={() => make('sticky_bar')} />
        </View>
      ) : null}
      <VersionInfoSheet version={info} onClose={() => setInfo(null)} />
    </SafeAreaView>
  );
}
