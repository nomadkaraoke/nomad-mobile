import type { SearchVersion } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** community | commercial | unknown (sing.js renderVersionRow). */
export function versionClass(v: SearchVersion): 'community' | 'commercial' | 'unknown' {
  if (v.priority_class === 'community' || v.priority_class === 'commercial') return v.priority_class;
  if (v.source === 'kn') return obj(v.kn).is_community ? 'community' : 'commercial';
  return 'unknown';
}

/** How sure we are it plays (A.23): on the box, our cloud mirror, or a YouTube download. */
export function availability(v: SearchVersion): { tier: 'sure' | 'high' | 'likely'; bytes?: number } {
  if (v.source === 'local') return { tier: 'sure' };
  const divebar = obj(obj(v.kn).divebar);
  if (str(divebar.file_id)) {
    const size = divebar.file_size;
    return { tier: 'high', ...(typeof size === 'number' && size > 0 ? { bytes: size } : {}) };
  }
  return { tier: 'likely' };
}

/** "MP4", "CDG+MP3", "YouTube" … (sing.js _versionFormat). */
export function versionFormat(v: SearchVersion): string {
  const fromExt = (s: string) => /\.([a-z0-9]+)$/i.exec(s)?.[1]?.toUpperCase() ?? '';
  const norm = (f: string) => {
    const up = f.toUpperCase();
    return up === 'ZIP' || up === 'CDG_ZIP' || up === 'CDG-ZIP' ? 'CDG+MP3' : up;
  };
  if (v.source === 'local') {
    const local = obj(v.local);
    return norm(str(local.format) || fromExt(str(local.filename) || str(local.path))) || 'FILE';
  }
  const divebar = obj(obj(v.kn).divebar);
  if (str(divebar.file_id)) return norm(str(divebar.format) || fromExt(str(divebar.drive_path))) || 'FILE';
  return 'YouTube';
}

/** The producer's display name, or null when unknown (a raw disc id is shown as a library file instead). */
export function brandName(v: SearchVersion): string | null {
  const kn = obj(v.kn);
  return v.priority_display || str(kn.brand_name) || str(kn.brand_code) || null;
}

/** "9 MB" (sing.js _humanFileSize). */
export function humanSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export type VersionRowProps = {
  version: SearchVersion;
  /** testID prefix, e.g. `tonight-version-0-1`. */
  testID: string;
  /** The auto-pick (versions[0]) gets "Best". */
  best?: boolean;
  /** Compact = no "Pick this version" (the song's own "Request this song" already picks it). */
  onPick?: () => void;
  /** Opens the explainer/tech sheet. */
  onInfo: () => void;
  /** ▶ Preview (shown only when wired). */
  onPreview?: () => void;
};

/** One version: Best, the producer, Community/Commercial + format pills (→ info sheet), availability, ▶, pick. */
export function VersionRow({ version, testID, best, onPick, onInfo, onPreview }: VersionRowProps) {
  const t = useTranslations('tonight.request.version');
  const cls = versionClass(version);
  const local = obj(version.local);
  const name = brandName(version);
  const brand = name ?? (str(local.disc_id) ? t('libraryFile', { id: str(local.disc_id) }) : t('unknownBrand'));
  const avail = availability(version);
  const availText =
    avail.tier === 'sure'
      ? t('sourceLocal')
      : avail.tier === 'high'
        ? avail.bytes
          ? t('sourceCloud', { size: humanSize(avail.bytes) })
          : t('sourceCloudNoSize')
        : t('sourceYouTube');
  return (
    <View testID={testID} className="gap-1.5 rounded-lg bg-card px-3 py-2">
      <View className="flex-row flex-wrap items-center gap-1.5">
        {best ? (
          <Text testID={`${testID}-best`} className="rounded-full bg-gold/20 px-2 py-0.5 text-xs font-bold text-gold">
            {t('best')}
          </Text>
        ) : null}
        <Pressable testID={`${testID}-brand`} accessibilityRole="button" hitSlop={6} onPress={onInfo} className="shrink">
          <Text className="font-semibold" numberOfLines={1}>
            {brand}
          </Text>
        </Pressable>
        {cls !== 'unknown' ? (
          <Pressable testID={`${testID}-class`} accessibilityRole="button" hitSlop={6} onPress={onInfo}>
            <Text
              className={`overflow-hidden rounded-full px-2 py-0.5 text-xs font-bold ${
                cls === 'community' ? 'bg-success/15 text-success' : 'bg-purple/20 text-purple'
              }`}
            >
              {cls === 'community' ? t('community') : t('commercial')}
            </Text>
          </Pressable>
        ) : null}
        <Pressable testID={`${testID}-format`} accessibilityRole="button" hitSlop={6} onPress={onInfo}>
          <Text className="overflow-hidden rounded-full border border-border px-2 py-0.5 text-xs">{versionFormat(version)}</Text>
        </Pressable>
      </View>
      <Text testID={`${testID}-availability`} variant="muted" className="text-xs">
        {availText}
      </Text>
      {onPreview || onPick ? (
        <View className="flex-row items-center justify-between gap-2">
          {onPreview ? (
            <Pressable testID={`${testID}-preview`} accessibilityRole="button" hitSlop={8} onPress={onPreview}>
              <Text className="text-sm font-semibold text-primary">{t('preview')}</Text>
            </Pressable>
          ) : (
            <View />
          )}
          {onPick ? (
            <Pressable testID={`${testID}-pick`} accessibilityRole="button" hitSlop={8} onPress={onPick}>
              <Text className="text-sm font-semibold text-primary">{t('pick')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
