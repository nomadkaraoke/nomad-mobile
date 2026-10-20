const origin = (u: string): string => (/^(https?:\/\/[^/?#]+)/i.exec(u)?.[1] ?? '').toLowerCase();

/**
 * Absolute URL for a media path from gen, with the auth token as `?token=`.
 * - `http(s)://...` is used as is (and gets the token only if it is on apiBase's origin);
 * - `/api/...` hangs off `apiBase`;
 * - any other path (e.g. `/instrumental-audio/clean`) is relative to `/api/review/{jobId}`.
 * A null token adds nothing. Tokens never persist: build URLs at play time.
 */
export function mediaUrl(apiBase: string, jobId: string, path: string, token: string | null): string {
  const base = apiBase.replace(/\/+$/, '');
  let url: string;
  if (/^https?:\/\//i.test(path)) url = path;
  else {
    const p = path.startsWith('/') ? path : `/${path}`;
    url = p.startsWith('/api/') ? `${base}${p}` : `${base}/api/review/${encodeURIComponent(jobId)}${p}`;
  }
  // Only our own API gets the token: other absolute URLs (pre-signed, CDN) pass through untouched.
  if (!token || origin(url) !== origin(base)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}
