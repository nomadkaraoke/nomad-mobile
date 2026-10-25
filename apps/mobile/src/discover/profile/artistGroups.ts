export type ArtistRow = { kind: 'header'; letter: string } | { kind: 'artist'; name: string; index: number };

/** First letter A-Z after stripping accents; anything else (digits, non-Latin scripts) is '#'. */
export function artistLetter(name: string): string {
  const first = name.trim().normalize('NFKD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' && first.length === 1 ? first : '#';
}

/** Flattens names into header + artist rows, A-Z then '#', for one List. `index` counts artists only. */
export function groupArtists(names: readonly string[]): ArtistRow[] {
  const groups = new Map<string, string[]>();
  for (const n of names) {
    const l = artistLetter(n);
    groups.set(l, [...(groups.get(l) ?? []), n]);
  }
  const letters = [...groups.keys()].sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a < b ? -1 : 1));
  const rows: ArtistRow[] = [];
  let index = 0;
  for (const letter of letters) {
    rows.push({ kind: 'header', letter });
    for (const name of [...(groups.get(letter) ?? [])].sort((a, b) => a.localeCompare(b))) {
      rows.push({ kind: 'artist', name, index: index++ });
    }
  }
  return rows;
}

const RANK: Record<string, number> = { love: 0, like: 1, occasionally: 2 };

/** Best affinity first (love > like > occasionally > unknown), then the given order. */
export function sortByAffinity<T extends { affinity?: string | null }>(artists: readonly T[]): T[] {
  return artists
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (RANK[x.a.affinity ?? ''] ?? 3) - (RANK[y.a.affinity ?? ''] ?? 3) || x.i - y.i)
    .map((x) => x.a);
}
