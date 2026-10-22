/** A night link: a 4-8 digit event code (the printed QR is `HTTP://KJBOX.CC/2121`, uppercase). */
const CODE = /^\d{4,8}$/;

/**
 * Pulls the event code out of anything a singer can scan or paste: `kjbox.cc/<code>` (any case, optional
 * `www.`), `sing.nomadkaraoke.com/?t=<code>` (or `/sing/?t=`), `nomadkaraoke://tonight?t=<code>`, or a bare
 * code. Everything else is null.
 */
export function parseNightLink(input: string): { code: string } | null {
  const s = (input ?? "").trim();
  if (CODE.test(s)) return { code: s };
  const m =
    /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(
      s,
    );
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  const host = m[2]!.toLowerCase().replace(/^www\./, "");
  const path = m[3]!;
  const query = new URLSearchParams(m[4] ?? "");
  let code: string | null = null;
  if (scheme === "http" || scheme === "https") {
    if (host === "kjbox.cc") {
      const seg = /^\/([^/]+)\/?$/.exec(path);
      if (seg && !query.has("t")) code = seg[1]!;
    } else if (host === "sing.nomadkaraoke.com") {
      if (path === "" || path === "/" || path === "/sing" || path === "/sing/")
        code = query.get("t");
    }
  } else if (scheme === "nomadkaraoke") {
    // nomadkaraoke://tonight?t=… (host "tonight") or nomadkaraoke:///tonight?t=… (path "/tonight")
    if (
      (host === "tonight" && (path === "" || path === "/")) ||
      (host === "" && /^\/tonight\/?$/.test(path))
    ) {
      code = query.get("t");
    }
  }
  return code !== null && CODE.test(code) ? { code } : null;
}

/** The singer's web page for this event code (ruling E4-R5: "Save tonight's songs"; E10: CD+G previews play there). */
export const singWebUrl = (code: string) => `https://sing.nomadkaraoke.com/?t=${encodeURIComponent(code)}`;
