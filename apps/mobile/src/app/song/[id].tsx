import { getSong } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text, TextField } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';

import { useAuth } from '../../auth/store';

export default function SongScreen() {
  const t = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const songId = Number(id);
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');

  const song = useQuery({
    queryKey: ['decide', 'song', songId],
    queryFn: () => getSong(songId),
    enabled: !isNew && Number.isFinite(songId),
  });

  const onMake = () => {
    if (!signedIn) {
      router.push({ pathname: '/sign-in', params: { returnTo: `/song/${id}` } });
      return;
    }
    // Phase 1 replaces this with the gen make flow (spec §2 step 3).
    Alert.alert(t('song.makeVideo'), t('song.comingSoon'));
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
          <Text variant="muted">{t('find.karaokeVersions', { count: song.data.brand_count })}</Text>
        </>
      ) : null}
      <Button
        testID="song-make"
        label={signedIn ? t('song.makeVideo') : t('song.signInToMake')}
        onPress={onMake}
        disabled={isNew && (!artist.trim() || !title.trim())}
      />
    </Screen>
  );
}
