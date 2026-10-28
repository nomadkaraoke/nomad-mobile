import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { router, useLocalSearchParams } from 'expo-router';

import { openSignIn } from '../../../auth/signInUi';
import { useAuth } from '../../../auth/store';
import { EMPTY_DRAFT, typedIntent, useMakeIntent } from '../../../make/intentStore';
import { SongHistory } from '../../../me/SongHistory';
import { SongLibraryActions } from '../../../me/SongLibraryActions';
import { useLibrary } from '../../../me/useLibrary';
import { artistLabel } from '../../../tonight/log/logStore';

/**
 * A song that isn't in the catalogue (library key `u:…`): its history, library actions and Make it. The artist and
 * title come as route params (they work offline); the library item is the fallback.
 */
export default function UncataloguedSongScreen() {
  const t = useTranslations('song');
  const tu = useTranslations('tonight.other');
  const p = useLocalSearchParams<{ key: string; artist?: string; title?: string }>();
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const { items } = useLibrary();
  const item = items.find((i) => i.key === p.key);
  const artist = p.artist ?? item?.artist ?? '';
  const title = p.title ?? item?.title ?? '';
  const shownArtist = artistLabel(artist, tu('unknownArtist'));
  const make = () => {
    useMakeIntent.getState().set(typedIntent({ ...EMPTY_DRAFT, artist, title }));
    if (signedIn) router.push('/make/new');
    else openSignIn('/make/new');
  };
  return (
    <Screen testID="history-screen" scroll>
      <Text testID="history-title" variant="title">
        {title}
      </Text>
      <Text testID="history-artist" variant="muted" className="text-base">
        {shownArtist}
      </Text>
      <SongLibraryActions song={{ artist, title, song_key: item?.song_key ?? null }} />
      <Button testID="history-make" label={t('makeIt')} onPress={make} disabled={!artist || !title} />
      <SongHistory libraryKey={p.key} />
    </Screen>
  );
}
