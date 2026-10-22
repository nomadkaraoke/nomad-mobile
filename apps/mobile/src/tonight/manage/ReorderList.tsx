import { KjboxError, reorder, type ReorderItem, type Song } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useNightStore, type NomadNight } from '../nightStore';
import { useEditingStore } from '../nomad/editingStore';
import { isLive, isOnStage, isOwnRequest, songKey, songParts } from '../nomad/model';
import { errorCopy } from '../request/errorCopy';
import { useInvalidateNight } from './SongActions';

/**
 * The rows a singer can move (the web's `_reorderableSongs`): live songs with a real queue position, not on stage;
 * their own approved requests by `id`, host-, partner- and web-added entries by `entry_id` (A.3, A.57).
 */
export function reorderable(songs: Song[]): { song: Song; item: ReorderItem }[] {
  const out: { song: Song; item: ReorderItem }[] = [];
  for (const s of songs) {
    if (!isLive(s) || isOnStage(s) || typeof s.estimate?.position !== 'number') continue;
    if (s.request.id == null) {
      if (s.entry_id != null) out.push({ song: s, item: { entry_id: s.entry_id } });
    } else if (isOwnRequest(s) && s.request.status === 'approved') {
      // Own and friend requests: friend songs keep the owner's device, who can reorder them (A.12).
      out.push({ song: s, item: { id: s.request.id } });
    }
  }
  return out;
}

/** `order` restricted to `current` keys, then any current key it lacks, in `current`'s order. */
export function reconcileOrder(order: string[], current: string[]): string[] {
  const live = new Set(current);
  const kept = order.filter((k) => live.has(k));
  const seen = new Set(kept);
  return [...kept, ...current.filter((k) => !seen.has(k))];
}

export type ReorderListProps = {
  night: NomadNight;
  userKey: string | null;
  songs: Song[];
  /** Saved (`'saved'` applied at once, `'requested'` waiting on the host) or cancelled (null). */
  onDone: (result: 'saved' | 'requested' | null) => void;
};

/**
 * Reorder mode (spec §4.1 Reorder, A.57, ruling E6-R3): explicit ▲/▼ buttons and row numbers, no hidden drag. Polling
 * pauses while it's open (editingStore), so rows never move under the singer's finger; Save sends ONE reorder call.
 */
export function ReorderList({ night, userKey, songs, onDone }: ReorderListProps) {
  const t = useTranslations('tonight.manage.reorder');
  const tNight = useTranslations('tonight.night');
  const tAll = useTranslations();
  const invalidate = useInvalidateNight(night, userKey);
  const rows = useMemo(() => reorderable(songs), [songs]);
  const [moved, setOrder] = useState(() => rows.map((r) => songKey(r.song)));
  // /me can refresh under the list (a pull, an invalidation): keep the singer's order for rows still here, drop the
  // ones that left, append new ones. Save only ever sends current rows.
  const order = reconcileOrder(moved, rows.map((r) => songKey(r.song)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    useEditingStore.getState().setEditing(true);
    return () => useEditingStore.getState().setEditing(false);
  }, []);

  const byKey = new Map(rows.map((r) => [songKey(r.song), r]));
  const move = (i: number, by: -1 | 1) =>
    setOrder(() => {
      const o = order;
      const j = i + by;
      if (j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const save = async () => {
    if (inFlight.current) return;
    const initial = rows.map((r) => songKey(r.song));
    if (order.every((k, i) => k === initial[i])) {
      onDone(null); // nothing moved: no request
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await reorder(night.code, order.map((k) => byKey.get(k)!.item), night.nightId);
      invalidate();
      onDone(res.auto_approved === false ? 'requested' : 'saved');
    } catch (e) {
      inFlight.current = false;
      setSaving(false);
      if (e instanceof KjboxError && e.code === 'night_changed') {
        useNightStore.getState().end();
        return;
      }
      const c = errorCopy(e);
      setError(tAll(c.key, c.values));
    }
  };

  const label = (s: Song) => {
    const { title, artist } = songParts(s.request);
    return artist ? tNight('songByArtist', { title: isolate(title), artist: isolate(artist) }) : title;
  };

  return (
    <View testID="tonight-reorder" className="gap-3">
      <Text className="text-lg font-bold">{t('title')}</Text>
      {rows.length < 2 ? (
        <Text testID="tonight-reorder-too-few" variant="muted">
          {t('tooFew')}
        </Text>
      ) : (
        <>
          <Text variant="muted">{t('hint')}</Text>
          {order.map((k, i) => {
            const s = byKey.get(k)!.song;
            const name = label(s);
            return (
              <View key={k} testID={`tonight-reorder-row-${k}`} className="flex-row items-center gap-2 rounded-lg border border-border bg-card p-2">
                <Text testID={`tonight-reorder-number-${k}`} className="w-8 text-center font-bold">
                  {t('number', { number: i + 1 })}
                </Text>
                <Text className="flex-1">{name}</Text>
                <ArrowButton testID={`tonight-reorder-up-${k}`} glyph="▲" label={t('up', { song: name })} disabled={i === 0 || saving} onPress={() => move(i, -1)} />
                <ArrowButton
                  testID={`tonight-reorder-down-${k}`}
                  glyph="▼"
                  label={t('down', { song: name })}
                  disabled={i === order.length - 1 || saving}
                  onPress={() => move(i, 1)}
                />
              </View>
            );
          })}
        </>
      )}
      {error ? (
        <Text testID="tonight-reorder-error" variant="error">
          {error}
        </Text>
      ) : null}
      <View className="gap-2">
        {rows.length >= 2 ? <Button testID="tonight-reorder-save" label={t('save')} onPress={() => void save()} loading={saving} /> : null}
        <Button testID="tonight-reorder-cancel" variant="secondary" label={t('cancel')} onPress={() => onDone(null)} disabled={saving} />
      </View>
    </View>
  );
}

function ArrowButton({ testID, glyph, label, disabled, onPress }: { testID: string; glyph: string; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-11 w-11 items-center justify-center rounded-md border border-border ${disabled ? 'opacity-30' : ''}`}
    >
      <Text importantForAccessibility="no" accessibilityElementsHidden className="text-lg">
        {glyph}
      </Text>
    </Pressable>
  );
}
