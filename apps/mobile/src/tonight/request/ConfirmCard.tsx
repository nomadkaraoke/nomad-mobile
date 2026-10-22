import type { SearchVersion } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { View } from 'react-native';

import { availability } from './VersionRow';

/** Which source line the confirm shows (sing.js confirm source copy). */
export type ConfirmSource = SearchVersion | 'auto' | 'make';

export type ConfirmCardProps = {
  title: string;
  artist: string;
  source: ConfirmSource;
  /** What the singer typed; shown as "You searched: …" except for make-its (A.19, ruling E5-R3). */
  searched?: string | null;
  /** Change mode: the song this replaces. */
  replacing?: string;
  /** Friend mode: who it's for. */
  friendName?: string;
  sending: boolean;
  /** Already-translated error copy. */
  error?: string | null;
  onSend: () => void;
  onBack: () => void;
};

/** The mandatory, hardened confirm (A.19): title and artist dominate, a source line, the breadcrumb, two clear buttons. */
export function ConfirmCard({ title, artist, source, searched, replacing, friendName, sending, error, onSend, onBack }: ConfirmCardProps) {
  const t = useTranslations('tonight.request.confirm');
  const sourceLine =
    source === 'make'
      ? t('sourceMake')
      : source === 'auto'
        ? t('sourceAuto')
        : { sure: t('sourceLocal'), high: t('sourceCloud'), likely: t('sourceOnline') }[availability(source).tier];
  const isMake = source === 'make';
  return (
    <View testID="tonight-confirm" className="gap-4">
      <Text variant="muted">{replacing ? t('changeTitle') : t('title')}</Text>
      {replacing ? (
        <Text testID="tonight-confirm-replacing" className="rounded-lg bg-gold/10 p-2">
          {t('changeHint', { song: isolate(replacing) })}
        </Text>
      ) : null}
      {friendName ? (
        <Text testID="tonight-confirm-friend" className="font-semibold">
          {t('forFriend', { name: isolate(friendName) })}
        </Text>
      ) : null}
      <View className="gap-1">
        <Text testID="tonight-confirm-title" className="text-3xl font-bold">
          {title}
        </Text>
        <Text testID="tonight-confirm-artist" className="text-xl">
          {artist}
        </Text>
      </View>
      <Text testID="tonight-confirm-source" variant="muted">
        {sourceLine}
      </Text>
      {searched && !isMake ? (
        <Text testID="tonight-confirm-searched" variant="muted" className="text-xs">
          {t('searched', { query: isolate(searched) })}
        </Text>
      ) : null}
      {error ? (
        <Text testID="tonight-confirm-error" variant="error">
          {error}
        </Text>
      ) : null}
      <View className="gap-2">
        <Button
          testID="tonight-confirm-send"
          label={error ? t('retry') : replacing ? t('sendChange') : t('send')}
          onPress={onSend}
          loading={sending}
        />
        <Button testID="tonight-confirm-back" variant="secondary" label={t('back')} onPress={onBack} disabled={sending} />
      </View>
    </View>
  );
}
