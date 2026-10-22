import { searchArtists, type ArtistSearchResult } from '@nomad/api-decide';
import { cycleAffinity, type Affinity, type ArtistIds } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { colors, Text, TextField } from '@nomad/ui';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useQuizDraft } from '../quizStore';
import { StepHeading } from './StepHeading';

export const ARTIST_SEARCH_DEBOUNCE_MS = 300;
export const ARTIST_SEARCH_LIMIT = 8;
const MIN_CHARS = 2;

const norm = (s: string) => s.trim().toLowerCase();

/** "✓ Like" / "♥ Love" on a picked artist. */
function Badge({ affinity }: { affinity: Affinity }) {
  const t = useTranslations('quiz');
  return (
    <Text className={`text-xs font-bold ${affinity === 'love' ? 'text-primary' : 'text-text'}`}>
      {affinity === 'love' ? t('badgeLove') : t('badgeLike')}
    </Text>
  );
}

type ArtistButtonProps = {
  testID: string;
  name: string;
  detail?: string | null;
  affinity: Affinity | undefined;
  onPress: () => void;
  tile?: boolean;
};

/** A tappable artist (search result, pick or suggestion): tap = like, again = love, again = off. */
function ArtistButton({ testID, name, detail, affinity, onPress, tile }: ArtistButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(affinity) }}
      onPress={onPress}
      className={`gap-1 rounded-xl border p-3 ${tile ? 'w-[48%]' : ''} ${
        affinity ? 'border-primary bg-primary/15' : 'border-border bg-card'
      }`}
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 font-semibold" numberOfLines={1}>
          {name}
        </Text>
        {affinity ? <Badge affinity={affinity} /> : null}
      </View>
      {detail ? (
        <Text variant="muted" numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Artists matching the box (decide's artist search), latest query only. Never free text: only results can be added. */
function useArtistSearch(query: string) {
  const q = query.trim();
  const [state, setState] = useState<{
    q: string;
    artists: ArtistSearchResult[];
  } | null>(null);
  useEffect(() => {
    if (q.length < MIN_CHARS) return;
    let live = true;
    const timer = setTimeout(() => {
      searchArtists(q, ARTIST_SEARCH_LIMIT).then(
        (res) => live && setState({ q, artists: res.artists }),
        () => live && setState({ q, artists: [] }),
      );
    }, ARTIST_SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);
  return q.length < MIN_CHARS ? null : state?.q === q ? state.artists : undefined;
}

/**
 * Step 3: search for artists, plus smart suggestions (each says why). A new pick asks for more suggestions;
 * an artist once shown stays, wherever it is.
 */
export function ArtistStep() {
  const t = useTranslations('quiz');
  const artists = useQuizDraft((s) => s.draft.artists);
  const suggestions = useQuizDraft((s) => s.suggestions);
  const suggesting = useQuizDraft((s) => s.suggesting);
  const [query, setQuery] = useState('');
  const results = useArtistSearch(query);
  // "Your artists" (picks that aren't suggestions) never drops an artist, even after a tap turns it off.
  const listed = useQuizDraft((s) => s.listed);

  // Resumed straight onto this step, the prefetch failed, or genres/decades changed since: ask now.
  useEffect(() => {
    useQuizDraft.getState().suggestIfStale();
  }, []);

  const affinityOf = (name: string) => artists.find((a) => norm(a.name) === norm(name))?.affinity;
  const tap = (name: string, ids?: ArtistIds) => {
    const s = useQuizDraft.getState();
    const isNew = !affinityOf(name);
    s.update((d) => cycleAffinity(d, name, ids));
    if (isNew) s.suggestSoon();
  };

  const suggested = useMemo(() => new Set(suggestions.map((a) => norm(a.name))), [suggestions]);
  const mine = useMemo(() => {
    const seen = new Set<string>();
    return [...listed, ...artists].filter((a) => {
      const k = norm(a.name);
      if (suggested.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [listed, artists, suggested]);

  return (
    <View className="gap-4">
      <StepHeading title={t('artistsTitle')} hint={t('artistsHint')} />
      <TextField
        testID="quiz-artist-search"
        label={t('artistSearchLabel')}
        placeholder={t('artistSearchPlaceholder')}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        returnKeyType="search"
      />
      {results === undefined ? <ActivityIndicator testID="quiz-artist-searching" color={colors.primary} /> : null}
      {results && results.length === 0 ? (
        <Text testID="quiz-artist-no-results" variant="muted">
          {t('artistNoResults')}
        </Text>
      ) : null}
      {results && results.length > 0 ? (
        <View className="gap-2">
          {results.map((r, i) => (
            <ArtistButton
              key={`${r.mbid ?? ''}${r.name}`}
              testID={`quiz-artist-result-${i}`}
              name={r.name}
              detail={r.disambiguation}
              affinity={affinityOf(r.name)}
              onPress={() => {
                // decide web sends the Spotify id as artist_id when there is one (catalog's artist_id falls back to the MBID).
                const ids = {
                  mbid: r.mbid,
                  artistId: r.spotify_id || r.artist_id || null,
                };
                useQuizDraft.getState().list({
                  name: r.name,
                  ...(ids.mbid ? { mbid: ids.mbid } : {}),
                  ...(ids.artistId ? { artistId: ids.artistId } : {}),
                });
                tap(r.name, ids);
              }}
            />
          ))}
        </View>
      ) : null}

      {mine.length > 0 ? (
        <View className="gap-2">
          <Text className="font-semibold">{t('yourArtists')}</Text>
          <View className="flex-row flex-wrap justify-between gap-y-2">
            {mine.map((a, i) => (
              <ArtistButton
                key={norm(a.name)}
                tile
                testID={`quiz-picked-artist-${i}`}
                name={a.name}
                affinity={affinityOf(a.name)}
                onPress={() => tap(a.name, a)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View className="gap-2">
        <Text className="font-semibold">{t('suggestionsTitle')}</Text>
        <View className="flex-row flex-wrap justify-between gap-y-2">
          {suggestions.map((a, i) => (
            <ArtistButton
              key={norm(a.name)}
              tile
              testID={`quiz-artist-suggestion-${i}`}
              name={a.name}
              detail={a.suggestion_reason?.display_text || t('reasonFallback')}
              affinity={affinityOf(a.name)}
              onPress={() => tap(a.name, { mbid: a.mbid, artistId: a.spotify_id })}
            />
          ))}
        </View>
        {suggesting ? (
          <View testID="quiz-suggestions-loading" className="flex-row items-center gap-2 py-2">
            <ActivityIndicator color={colors.primary} />
            <Text variant="muted">{t('suggestionsLoading')}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
