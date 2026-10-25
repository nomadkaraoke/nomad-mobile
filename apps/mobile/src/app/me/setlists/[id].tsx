import type { PlaylistItemOut } from '@nomad/api-decide';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, List, Text } from '@nomad/ui';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { openSignIn } from '../../../auth/signInUi';
import { useAuth } from '../../../auth/store';
import { identifiedIntent, typedIntent, useMakeIntent } from '../../../make/intentStore';
import { SetlistItemRow, itemSong } from '../../../me/SetlistItemRow';
import { MarkSungSheet } from '../../../me/MarkSungSheet';
import { SetlistNameSheet } from '../../../me/SetlistNameSheet';
import { SetlistSearchSheet } from '../../../me/SetlistSearchSheet';
import { useSetlists } from '../../../me/useSetlists';

/** One setlist: its songs with per-song actions, add songs, rename, delete, and an explicit Edit order mode. */
export default function SetlistScreen() {
  const t = useTranslations('me.setlists');
  const { id } = useLocalSearchParams<{ id: string }>();
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const { setlists, loading, renameSetlist, setItems, addSongs, removeItem, deleteSetlist } = useSetlists();
  const list = setlists.find((s) => s.id === id);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [mark, setMark] = useState<{ n: number; song: { artist: string; title: string; song_key?: string } } | null>(null);
  const [order, setOrder] = useState<PlaylistItemOut[] | null>(null);
  const [full, setFull] = useState(false);

  if (!list) {
    return (
      <View testID="setlist" className="flex-1 bg-bg p-4">
        {loading ? (
          <ActivityIndicator testID="setlist-loading" />
        ) : (
          <Text testID="setlist-not-found" variant="muted">
            {t('notFound')}
          </Text>
        )}
      </View>
    );
  }

  const items = list.items ?? [];
  const shown = order ?? items;
  const editing = order !== null;

  const confirmDelete = () =>
    Alert.alert(t('deleteTitle'), t('deleteBody', { name: isolate(list.name) }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          deleteSetlist(list.id);
          if (router.canGoBack()) router.back();
          else router.replace('/me/setlists' as Href);
        },
      },
    ]);

  const make = (item: PlaylistItemOut) => {
    const s = itemSong(item);
    useMakeIntent.getState().set(s.song_key ? identifiedIntent({ artist: s.artist, title: s.title, song_key: s.song_key }) : typedIntent({ artist: s.artist, title: s.title, editedFields: [] }));
    if (signedIn) router.push('/make/new');
    else openSignIn('/make/new');
  };

  const move = (i: number, by: -1 | 1) =>
    setOrder((o) => {
      const cur = o ?? items;
      const j = i + by;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const saveOrder = () => {
    if (order) {
      const ok = setItems(list.id, order.map((x) => ({ item_id: x.item_id, song_key: x.song_key, artist: x.artist, title: x.title })));
      if (!ok) {
        setFull(true); // refused (past 500): stay in edit mode so the order isn't lost
        return;
      }
    }
    setFull(false);
    setOrder(null);
  };

  const header = (
    <View className="gap-3 p-4">
      <Text testID="setlist-name" className="text-xl font-bold">
        {isolate(list.name)}
      </Text>
      <Text variant="muted">{t('count', { count: items.length })}</Text>
      {editing ? (
        <View className="gap-2">
          <Button testID="setlist-order-save" label={t('saveOrder')} onPress={saveOrder} />
          <Button testID="setlist-order-cancel" variant="secondary" label={t('cancelOrder')} onPress={() => setOrder(null)} />
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          <Button testID="setlist-add" label={t('add')} onPress={() => setAdding(true)} />
          {items.length > 1 ? <Button testID="setlist-edit-order" variant="secondary" label={t('editOrder')} onPress={() => setOrder(items)} /> : null}
          <Button testID="setlist-rename" variant="secondary" label={t('rename')} onPress={() => setRenaming(true)} />
          <Button testID="setlist-delete" variant="secondary" label={t('delete')} onPress={confirmDelete} />
        </View>
      )}
      {full ? (
        <Text testID="setlist-full" variant="error">
          {t('full')}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View testID="setlist" className="flex-1 bg-bg">
      <List
        testID="setlist-items"
        data={shown}
        extraData={editing}
        keyExtractor={(x) => x.item_id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text testID="setlist-empty" variant="muted" className="px-4">
            {t('itemsEmpty')}
          </Text>
        }
        renderItem={(item, i) => (
          <SetlistItemRow
            item={item}
            index={i}
            count={shown.length}
            editing={editing}
            onMove={(by) => move(i, by)}
            onSung={() => {
              const s = itemSong(item);
              setMark({ n: i, song: { artist: s.artist, title: s.title, ...(s.song_key ? { song_key: s.song_key } : {}) } });
            }}
            onMake={() => make(item)}
            onRemove={() => removeItem(list.id, item.item_id)}
          />
        )}
      />
      <SetlistNameSheet visible={renaming} initial={list.name} title={t('renameTitle')} onSave={(name) => renameSetlist(list.id, name)} onClose={() => setRenaming(false)} />
      <SetlistSearchSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onPick={(song) => {
          const res = addSongs([list.id], song);
          setFull(res.full.length > 0);
          return res.full.length === 0;
        }}
      />
      <MarkSungSheet key={mark?.n ?? 'none'} song={mark?.song ?? null} onClose={() => setMark(null)} />
    </View>
  );
}
