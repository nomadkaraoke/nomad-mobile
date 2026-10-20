/**
 * Absolute URL for a media path from gen, with the auth token as `?token=`.
 * - `http(s)://...` is used as is;
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
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}
