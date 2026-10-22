import type { NightOpen } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Linking, Pressable, View } from 'react-native';

const BUILT_IN = new Set(['chargers', 'lyricsScreen', 'duets', 'moreSongs', 'tipsHelp', 'wifi', 'water', 'photos']);
const SOCIALS = ['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'website'] as const;

function LinkButton({ testID, label, url }: { testID: string; label: string; url: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => void Linking.openURL(url)}
      className="min-h-11 justify-center rounded-md border border-border px-3"
    >
      <Text>{label}</Text>
    </Pressable>
  );
}

/**
 * Venue info (spec §4.1, A.90): switched-on notices (the app's copy for built-in keys; the host's own icon and text,
 * as typed, for host-written or host-edited ones), the host's message, socials and "Contact the host".
 */
export function VenueInfo({ night }: { night: NightOpen }) {
  const t = useTranslations('tonight.night');
  const notices = night.notices
    .map((key) => {
      const def = night.notice_defs[key];
      if (def) return { key, text: `${def.icon} ${def.text}`.trim() };
      return BUILT_IN.has(key) ? { key, text: t(`venue.notices.${key}`) } : null;
    })
    .filter((n): n is { key: string; text: string } => n !== null);
  const socials = SOCIALS.filter((k) => night.social[k]);
  const phone = night.contact.phone;
  const email = night.contact.email;
  if (!notices.length && !night.footer_message && !socials.length && !phone && !email) return null;
  return (
    <View testID="tonight-venue" className="gap-2 pt-4">
      <Text className="text-lg font-bold">{t('venue.title')}</Text>
      {notices.map((n) => (
        <Text key={n.key} testID={`tonight-notice-${n.key}`}>
          {n.text}
        </Text>
      ))}
      {night.footer_message ? (
        <View className="gap-1 rounded-lg bg-card p-3">
          <Text variant="muted">{t('venue.message')}</Text>
          <Text testID="tonight-host-message">{night.footer_message}</Text>
        </View>
      ) : null}
      {phone || email ? (
        <View className="gap-1">
          <Text variant="muted">{t('venue.contact')}</Text>
          <View className="flex-row flex-wrap gap-2">
            {phone ? <LinkButton testID="tonight-contact-text" label={t('venue.text')} url={`sms:${phone}`} /> : null}
            {phone ? <LinkButton testID="tonight-contact-call" label={t('venue.call')} url={`tel:${phone}`} /> : null}
            {email ? <LinkButton testID="tonight-contact-email" label={t('venue.email')} url={`mailto:${email}`} /> : null}
          </View>
        </View>
      ) : null}
      {socials.length ? (
        <View className="gap-1">
          <Text variant="muted">{t('venue.followUs')}</Text>
          <View className="flex-row flex-wrap gap-2">
            {socials.map((k) => (
              <LinkButton key={k} testID={`tonight-social-${k}`} label={t(`venue.social.${k}`)} url={night.social[k]!} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
