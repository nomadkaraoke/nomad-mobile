import type { Version } from '@nomad/api-decide';
import type { JobSummary } from '@nomad/api-gen';
import { sameSong } from '@nomad/core';
import { Linking } from 'react-native';

// The app's one YouTube module: id parsing, URLs, gen's video title, opening a video (job page, song page, Discover,
// Make, Tonight, the voice session's link-out) and the link Tonight hands a host.

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
export const youtubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

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
 * Opens the video: the https watch URL is a universal link (iOS) / app link (Android), so the YouTube app opens it
 * when installed, otherwise the browser. No `canOpenURL` probe: it throws on iOS without LSApplicationQueriesSchemes
 * and is false on Android without a manifest <queries> entry (Phase 3d spike D1). Rejects when nothing can open it.
 */
export async function openYouTube(id: string): Promise<void> {
  await Linking.openURL(youtubeWatchUrl(id));
}

/** Opens a link from gen or decide: a YouTube link through `openYouTube`, anything else as it is. */
export async function openYouTubeUrl(url: string): Promise<void> {
  const id = youtubeId(url);
  await (id ? openYouTube(id) : Linking.openURL(url));
}

export type YouTubeSources = {
  /** The signed-in user's gen jobs (Phase 1's jobs list). */
  jobs?: readonly JobSummary[];
  /** decide's karaoke versions of the song (its `song_key`). */
  versions?: readonly Version[];
};

/**
 * The YouTube link to hand the host for a song logged at another bar (Tonight spec §6.2, ruling E9-R4): the user's own
 * gen-made video of the same artist + title, else a community version's `youtube_url` from decide search, else null
 * (commercial versions are never offered: those videos aren't ours to point a host at).
 */
export function youTubeLinkFor(song: { artist: string; title: string }, { jobs, versions }: YouTubeSources): string | null {
  for (const job of jobs ?? []) {
    const url = job.state_data?.youtube_url;
    if (url && sameSong({ artist: job.artist ?? '', title: job.title ?? '' }, song)) return url;
  }
  for (const v of versions ?? []) {
    if (v.kind === 'community' && v.youtube_url) return v.youtube_url;
  }
  return null;
}
