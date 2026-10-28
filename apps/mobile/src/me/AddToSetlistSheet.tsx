import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Sheet, Text, TextField } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { artistLabel } from '../tonight/log/logStore';
import { MAX_NAME } from './SetlistNameSheet';
import { useSetlists } from './useSetlists';

export type AddSong = { artist: string; title: string; song_key?: string | null };

/** The setlist item that is this song (same song_key, else same artist and title), if any. */
export function findInSetlist<T extends { song_key?: string | null; artist?: string | null; title?: string | null }>(items: readonly T[] | undefined, song: AddSong): T | undefined {
  return (items ?? []).find((x) =>
    x.song_key && song.song_key ? x.song_key === song.song_key : (x.artist ?? '') === song.artist && (x.title ?? '') === song.title,
  );
}

/** "Add to setlist": tick the setlists the song should be in (ticked = already in), or start a new one. Done applies the changes. */
export function AddToSetlistSheet({ song, onClose }: { song: AddSong | null; onClose(): void }) {
  const t = useTranslations('me.setlists');
  const tOther = useTranslations('tonight.other');
  const { setlists, createSetlist, addSongs, removeItem } = useSetlists();
  // The person's changes over what each setlist already holds.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [newName, setNewName] = useState('');
  const [full, setFull] = useState(false);

  const isMember = (id: string) => !!song && !!findInSetlist(setlists.find((s) => s.id === id)?.items, song);
  const checked = (id: string) => ticks[id] ?? isMember(id);
  const close = () => {
    setTicks({});
    setNewName('');
    setFull(false);
    onClose();
  };

  const createAndAdd = () => {
    const name = newName.trim();
    if (!song || !name) return;
    const id = createSetlist(name);
    addSongs([id], song);
    setNewName('');
  };

  const done = () => {
    if (song) {
      const toAdd = setlists.filter((s) => ticks[s.id] === true && !isMember(s.id)).map((s) => s.id);
      const res = addSongs(toAdd, song);
      for (const s of setlists) {
        if (ticks[s.id] !== false) continue;
        const it = findInSetlist(s.items, song);
        if (it) removeItem(s.id, it.item_id);
      }
      if (res.full.length > 0) {
        setFull(true);
        setTicks({});
        return;
      }
    }
    close();
  };

  return (
    <Sheet visible={song !== null} onClose={close} title={t('addToTitle')} testID="add-to-setlist" closeLabel={t('close')} fullHeight>
      <View className="gap-3">
        {song ? <Text variant="muted">{t('songValue', { title: isolate(song.title), artist: isolate(artistLabel(song.artist, tOther('unknownArtist'))) })}</Text> : null}
        <ScrollView className="max-h-72" keyboardShouldPersistTaps="handled">
          <View className="gap-2">
            {setlists.map((s) => {
              const on = checked(s.id);
              return (
                <Pressable
                  key={s.id}
                  testID={`add-setlist-${s.id}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setTicks((p) => ({ ...p, [s.id]: !on }))}
                  className={`min-h-11 flex-row items-center gap-3 rounded-xl border p-3 ${on ? 'border-primary bg-primary/15' : 'border-border bg-card'}`}
                >
                  <Text className="w-5 text-primary">{on ? '✓' : ''}</Text>
                  <Text className="flex-1" numberOfLines={1}>
                    {isolate(s.name)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <TextField
          testID="add-setlist-new-input"
          label={t('nameLabel')}
          placeholder={t('addNewPlaceholder')}
          value={newName}
          onChangeText={setNewName}
          maxLength={MAX_NAME}
          returnKeyType="done"
          onSubmitEditing={createAndAdd}
        />
        <Button testID="add-setlist-new" variant="secondary" label={t('addNew')} onPress={createAndAdd} disabled={newName.trim().length === 0} />
        {full ? (
          <Text testID="add-setlist-full" variant="error">
            {t('full')}
          </Text>
        ) : null}
        <Button testID="add-setlist-done" label={t('done')} onPress={done} />
      </View>
    </Sheet>
  );
}
