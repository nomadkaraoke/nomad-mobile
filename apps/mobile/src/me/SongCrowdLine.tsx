import { getSongCrowd, type SongCrowd } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../auth/store';
import { useOffline } from '../net/useOffline';
import { useUserKey } from './account';
import { useSyncedVoiceKey } from './useRecsGoTos';

/** decide's voice buckets (spec §6.7) → their `song.crowd.bucket.*` sentence. */
const BUCKETS = ['bass', 'baritone', 'tenor', 'alto', 'mezzo', 'soprano'] as const;
type Bucket = (typeof BUCKETS)[number];
const isBucket = (b: string | null | undefined): b is Bucket => !!b && (BUCKETS as readonly string[]).includes(b);

/** "Most singers found it a bit high" from this share of too-high answers. */
export const CROWD_MOSTLY_HIGH_SHARE = 0.6;

type Line =
  | { kind: 'bucket'; bucket: Bucket; share: number }
  | { kind: 'mostlyHigh' }
  | { kind: 'overall'; comfortable: number; singers: number };

/**
 * Which line decide's figure gives, or null. decide applies the thresholds (≥ 5 singers overall, ≥ 5 in the viewer's
 * bucket) and sends nulls below them, so this only reads what is there and never derives a figure decide didn't send.
 * The viewer's own bucket first; then "mostly too high" (otherwise unreachable: decide's too-high share only comes
 * with the overall figure); then the overall count, from decide's share of its own singer count.
 */
export function crowdLine(c: SongCrowd | undefined): Line | null {
  if (!c) return null;
  if (isBucket(c.bucket) && c.bucket_comfortable_share != null) {
    return { kind: 'bucket', bucket: c.bucket, share: c.bucket_comfortable_share };
  }
  if (c.too_high_share != null && c.too_high_share >= CROWD_MOSTLY_HIGH_SHARE) return { kind: 'mostlyHigh' };
  if (c.singers != null && c.comfortable_share != null) {
    return { kind: 'overall', comfortable: Math.round(c.comfortable_share * c.singers), singers: c.singers };
  }
  return null;
}

/**
 * The song page's crowd singability line (Phase 4b, spec §6.7): "72% of baritones found the key comfortable",
 * "8 of 11 singers found the key comfortable" or "Most singers found it a bit high". Signed in only (decide reads the
 * viewer's bucket from their token). Offline it keeps the last answer this launch fetched, or shows nothing.
 */
export function SongCrowdLine({ songKey }: { songKey: string }) {
  const t = useTranslations('song.crowd');
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const userKey = useUserKey();
  const offline = useOffline();
  // decide reads the viewer's bucket from the voice profile it has: a newly synced profile refetches (as recs do).
  // While a new profile is still being sent, the last synced key stays (no blank line meanwhile).
  const voice = useSyncedVoiceKey();
  const q = useQuery({
    queryKey: ['decide', userKey, 'crowd', songKey, voice],
    queryFn: () => getSongCrowd(songKey),
    enabled: signedIn && userKey !== null && !offline,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const line = signedIn ? crowdLine(q.data) : null;
  if (!line) return null;
  const text =
    line.kind === 'bucket'
      ? t(`bucket.${line.bucket}`, { share: line.share })
      : line.kind === 'mostlyHigh'
        ? t('mostlyHigh')
        : t('overall', { comfortable: line.comfortable, singers: line.singers });
  return (
    <Text testID="song-crowd" variant="muted" className="text-xs">
      {text}
    </Text>
  );
}
