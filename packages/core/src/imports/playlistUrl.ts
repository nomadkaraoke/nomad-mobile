// Playlist links pasted or shared into the app (the share text may wrap the URL in prose).

const SPOTIFY_URL_RE = /(?:https?:\/\/)?open\.spotify\.com\/(?:[\w-]+\/)*?playlist\/([A-Za-z0-9]+)/i;
const SPOTIFY_URI_RE = /spotify:(?:user:[^:\s]+:)?playlist:([A-Za-z0-9]+)/i;
const YOUTUBE_RE = /(?:https?:\/\/)?(?:(music|www|m)\.)?youtube\.com\/playlist\?(?:[^\s#]*?&)?list=([\w-]+)/i;

/**
 * The first Spotify or YouTube (Music) playlist link in `text`, normalized (tracking
 * parameters dropped), or null. Any youtube.com playlist counts as YouTube Music: decide
 * reads it by its list id.
 */
export function classifyPlaylistUrl(text: string): { service: 'spotify' | 'youtube_music'; url: string } | null {
  const sp = SPOTIFY_URL_RE.exec(text) ?? SPOTIFY_URI_RE.exec(text);
  if (sp) return { service: 'spotify', url: `https://open.spotify.com/playlist/${sp[1]}` };
  const yt = YOUTUBE_RE.exec(text);
  if (yt) {
    const host = yt[1]?.toLowerCase() === 'music' ? 'music.youtube.com' : 'www.youtube.com';
    return { service: 'youtube_music', url: `https://${host}/playlist?list=${yt[2]}` };
  }
  return null;
}
