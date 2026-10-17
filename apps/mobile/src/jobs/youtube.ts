import { Linking, Platform } from 'react-native';

// Plain regexes rather than URL/URLSearchParams: React Native's URL polyfill is incomplete on device.
const ID = '([A-Za-z0-9_-]{11})(?=$|[?&#/])';
const FORMS = [
  new RegExp(`^(?:https?://)?youtu\\.be/${ID}`, 'i'),
  new RegExp(`^(?:https?://)?(?:www\\.|m\\.|music\\.)?youtube\\.com/(?:shorts|live|embed)/${ID}`, 'i'),
  new RegExp(`^(?:https?://)?(?:www\\.|m\\.|music\\.)?youtube\\.com/watch/?\\?(?:[^#]*&)?v=${ID}`, 'i'),
];

/** The 11-character video id from a youtu.be, watch?v=, /shorts/, /live/ or /embed/ link; null otherwise. */
export function youtubeId(raw: string): string | null {
  const text = raw.trim();
  for (const form of FORMS) {
    const match = form.exec(text);
    if (match) return match[1] ?? null;
  }
  return null;
}

export const youtubeThumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const youtubeShortUrl = (id: string) => `https://youtu.be/${id}`;

// gen's youtube_queue_processor caps the title at 95 characters: [:92] + " ...".
const YOUTUBE_TITLE_MAX = 95;

/**
 * The title gen gives the YouTube video (backend/services/youtube_description.py build_youtube_title):
 * "Artist - Title (Karaoke)". Gen doesn't store the uploaded title and the brand code only goes in the
 * description, so it's rebuilt here rather than fetched from oEmbed. (Videos with translated lyrics
 * carry an extra "(With Translation into …)" label; the app doesn't have gen's language names yet.)
 */
export function youtubeTitle({ artist, title }: { artist?: string; title?: string }): string {
  const full = `${artist || 'Unknown'} - ${title || 'Unknown'} (Karaoke)`;
  return full.length > YOUTUBE_TITLE_MAX ? `${full.slice(0, 92)} ...` : full;
}

/**
 * Opens the video in the YouTube app when it's installed (iOS lists the schemes in
 * LSApplicationQueriesSchemes), otherwise the browser. On Android canOpenURL is false without a
 * <queries> entry, but the https link opens the YouTube app there anyway through its app links.
 */
export async function openYouTube(id: string): Promise<void> {
  const app = Platform.OS === 'android' ? `vnd.youtube://${id}` : `youtube://${id}`;
  try {
    if (await Linking.canOpenURL(app)) {
      await Linking.openURL(app);
      return;
    }
  } catch {
    // Fall through to the browser.
  }
  await Linking.openURL(youtubeShortUrl(id));
}
