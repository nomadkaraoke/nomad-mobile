import { songLibraries, type LibraryTagged } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { View } from 'react-native';

/** Row pills for the libraries a song is in ("Community", "KaraFun"); nothing when it has no tag. */
export function LibraryBadge({ song }: { song: LibraryTagged }) {
  const t = useTranslations('discover');
  const tags = songLibraries(song);
  if (tags.size === 0) return null;
  return (
    <View className="flex-row flex-wrap items-center gap-1.5">
      {tags.has('community') ? (
        <View testID="library-badge-community" className="rounded-full bg-purple/20 px-2 py-0.5">
          <Text className="text-xs font-semibold text-purple">{t('libraryCommunity')}</Text>
        </View>
      ) : null}
      {tags.has('karafun') ? (
        <View testID="library-badge-karafun" className="rounded-full bg-gold/15 px-2 py-0.5">
          <Text className="text-xs font-semibold text-gold">{t('libraryKarafun')}</Text>
        </View>
      ) : null}
    </View>
  );
}
