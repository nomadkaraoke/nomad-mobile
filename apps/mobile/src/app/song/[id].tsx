import { getSong } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text, TextField } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../../auth/store';
import { useMakeIntent } from '../../make/intentStore';

/** A decide song (spec §4.2), or `id=new` for "make any song" with typed artist and title. */
export default function SongScreen() {
  const t = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const songId = Number(id);
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const setIntent = useMakeIntent((s) => s.set);
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');

  const song = useQuery({
    queryKey: ['decide', 'song', songId],
    queryFn: () => getSong(songId),
    enabled: !isNew && Number.isFinite(songId),
  });

  const target = isNew
    ? { artist: artist.trim(), title: title.trim() }
    : song.data
      ? { artist: song.data.artist, title: song.data.title, decideSongId: song.data.id }
      : null;
  const canMake = target !== null && target.artist !== '' && target.title !== '';

  const onMake = () => {
    if (!canMake) return;
    setIntent({ ...target, createdAt: Date.now() });
    // Sign-in carries straight on into the make flow (spec §4.3).
    if (signedIn) router.push('/make/new');
    else router.push({ pathname: '/sign-in', params: { returnTo: '/make/new' } });
  };

  return (
    <Screen testID="song-screen" scroll>
      {isNew ? (
        <>
          <TextField testID="song-artist" label={t('song.artistLabel')} value={artist} onChangeText={setArtist} />
          <TextField testID="song-title" label={t('song.titleLabel')} value={title} onChangeText={setTitle} />
        </>
      ) : song.isLoading ? (
        <ActivityIndicator testID="song-loading" />
      ) : song.isError ? (
        <>
          <Text variant="error">{t('common.error')}</Text>
          <Button testID="song-retry" label={t('common.retry')} variant="secondary" onPress={() => void song.refetch()} />
        </>
      ) : song.data ? (
        <>
          <Text variant="title">{song.data.title}</Text>
          <Text variant="muted">{song.data.artist}</Text>
          <View className="flex-row">
            {song.data.brand_count === 0 ? (
              <Text testID="song-badge" className="rounded-full bg-gold/15 px-3 py-1 text-sm font-semibold text-gold">
                {t('song.noKaraoke')}
              </Text>
            ) : (
              <Text testID="song-badge" className="rounded-full bg-card px-3 py-1 text-sm text-muted">
                {t('song.hasKaraoke')}
              </Text>
            )}
          </View>
        </>
      ) : null}
      <Button testID="song-make" label={t('song.makeIt')} onPress={onMake} disabled={!canMake} />
    </Screen>
  );
}
