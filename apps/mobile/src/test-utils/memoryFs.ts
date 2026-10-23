/* In-memory stand-ins for expo-file-system (File/Directory/Paths/FileHandle/downloadFileAsync) and
 * expo-sqlite (openDatabaseSync over those files), for the offline index tests.
 *
 * A "database" file holds JSON: `{ meta: {...}, check?: string, rows?: [...] }`. Opening anything else
 * throws like SQLite's "file is not a database"; `check` is what PRAGMA quick_check answers ("ok" by default).
 */

type Remote = Uint8Array | Error;

export const fsState = {
  files: new Map<string, Uint8Array>(),
  dirs: new Set<string>(),
  remote: new Map<string, Remote>(),
  /** Every create / move / delete, in order (`create <uri>`, `move <from> -> <to>`, `delete <uri>`). */
  log: [] as string[],
  /** Called by downloadFileAsync after it has written the file (tests use it to act mid-download). */
  afterDownload: null as null | (() => void | Promise<void>),
  /** Size of every FileHandle.readBytes call, in order; `onRead` runs after each one. */
  reads: [] as number[],
  onRead: null as null | ((readSoFar: number) => void),
  openDbs: [] as MemoryDb[],
  reset() {
    this.files.clear();
    this.dirs.clear();
    this.remote.clear();
    this.log.length = 0;
    this.afterDownload = null;
    this.reads.length = 0;
    this.onRead = null;
    this.openDbs.length = 0;
  },
};

const join = (base: string, name: string) => `${base.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`;
const uriOf = (parts: (string | { uri: string })[]) =>
  parts.map((p) => (typeof p === 'string' ? p : p.uri)).reduce((a, b) => join(a, b));

export class Directory {
  uri: string;
  constructor(...parts: (string | { uri: string })[]) {
    this.uri = uriOf(parts);
  }
  get exists() {
    return fsState.dirs.has(this.uri);
  }
  create(_opts?: { intermediates?: boolean; idempotent?: boolean }) {
    fsState.dirs.add(this.uri);
  }
  delete() {
    if (!this.exists) throw new Error(`no such directory: ${this.uri}`);
    for (const k of [...fsState.files.keys()]) if (k.startsWith(`${this.uri}/`)) fsState.files.delete(k);
    fsState.dirs.delete(this.uri);
    fsState.log.push(`delete ${this.uri}`);
  }
  list() {
    return [...fsState.files.keys()].filter((k) => k.startsWith(`${this.uri}/`)).map((k) => new File(k));
  }
}

export class FileHandle {
  offset = 0;
  private closed = false;
  constructor(private readonly uri: string) {}
  get size() {
    return this.closed ? null : (fsState.files.get(this.uri)?.length ?? 0);
  }
  readBytes(n: number) {
    if (this.closed) throw new Error('handle closed');
    const data = fsState.files.get(this.uri) ?? new Uint8Array();
    const out = data.slice(this.offset, this.offset + n);
    this.offset += out.length;
    fsState.reads.push(n);
    fsState.onRead?.(this.offset);
    return out;
  }
  writeBytes(bytes: Uint8Array) {
    if (this.closed) throw new Error('handle closed');
    const data = fsState.files.get(this.uri) ?? new Uint8Array();
    const next = new Uint8Array(Math.max(data.length, this.offset + bytes.length));
    next.set(data);
    next.set(bytes, this.offset);
    fsState.files.set(this.uri, next);
    this.offset += bytes.length;
  }
  close() {
    this.closed = true;
  }
}

export class File {
  uri: string;
  constructor(...parts: (string | { uri: string })[]) {
    this.uri = uriOf(parts);
  }
  get name() {
    return this.uri.slice(this.uri.lastIndexOf('/') + 1);
  }
  get exists() {
    return fsState.files.has(this.uri);
  }
  get size() {
    return fsState.files.get(this.uri)?.length ?? 0;
  }
  /** Like expo-file-system's File (a Blob): the MIME type from the extension. */
  get type() {
    const ext = this.uri.slice(this.uri.lastIndexOf('.') + 1).toLowerCase();
    return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', zip: 'application/zip', csv: 'text/csv' } as Record<string, string>)[ext] ?? '';
  }
  /** What expo/fetch reads from a FormData part. */
  async bytes() {
    const data = fsState.files.get(this.uri);
    if (!data) throw new Error(`no such file: ${this.uri}`);
    return data;
  }
  create({ overwrite = false } = {}) {
    if (this.exists && !overwrite) throw new Error(`exists: ${this.uri}`);
    fsState.files.set(this.uri, new Uint8Array());
    fsState.log.push(`create ${this.uri}`);
  }
  delete() {
    if (!this.exists) throw new Error(`no such file: ${this.uri}`);
    fsState.files.delete(this.uri);
    fsState.log.push(`delete ${this.uri}`);
  }
  moveSync(dest: File, { overwrite = false } = {}) {
    if (!this.exists) throw new Error(`no such file: ${this.uri}`);
    if (dest.exists && !overwrite) throw new Error(`exists: ${dest.uri}`);
    fsState.files.set(dest.uri, fsState.files.get(this.uri)!);
    fsState.files.delete(this.uri);
    fsState.log.push(`move ${this.uri} -> ${dest.uri}`);
    this.uri = dest.uri;
  }
  open() {
    if (!this.exists) throw new Error(`no such file: ${this.uri}`);
    return new FileHandle(this.uri);
  }
  async text() {
    const data = fsState.files.get(this.uri);
    if (!data) throw new Error(`no such file: ${this.uri}`);
    return new TextDecoder().decode(data);
  }
  write(content: string | Uint8Array) {
    fsState.files.set(this.uri, typeof content === 'string' ? new TextEncoder().encode(content) : content);
  }

  static downloadFileAsync = jest.fn(
    async (url: string, dest: File, opts: { onProgress?: (p: { bytesWritten: number; totalBytes: number }) => void; signal?: AbortSignal } = {}) => {
      const body = fsState.remote.get(url);
      if (body === undefined) throw new Error('Unable to download a file: response has status: 404');
      if (body instanceof Error) throw body;
      opts.onProgress?.({ bytesWritten: body.length >> 1, totalBytes: body.length });
      fsState.files.set(dest.uri, body.slice());
      opts.onProgress?.({ bytesWritten: body.length, totalBytes: body.length });
      await fsState.afterDownload?.();
      if (opts.signal?.aborted) throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
      return dest;
    },
  );
}

export const Paths = { cache: 'file:///cache', document: 'file:///document' };

/** An open "database": a snapshot of the file's JSON at open time. */
export class MemoryDb {
  closed = false;
  readonly path: string;
  private readonly doc: { meta: Record<string, string>; check?: string; rows?: unknown[] };
  constructor(path: string) {
    this.path = path;
    const bytes = fsState.files.get(path);
    if (!bytes) throw new Error(`unable to open database file: ${path}`);
    try {
      this.doc = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error('file is not a database');
    }
  }
  private live() {
    if (this.closed) throw new Error('database is closed');
  }
  /** Every SQL statement run on this connection. */
  readonly queries: string[] = [];
  getFirstSync(sql: string) {
    this.live();
    this.queries.push(sql);
    if (sql.startsWith('PRAGMA quick_check')) return { quick_check: this.doc.check ?? 'ok' };
    return null;
  }
  getAllSync(sql: string) {
    this.live();
    this.queries.push(sql);
    if (sql.includes('FROM meta')) return Object.entries(this.doc.meta).map(([key, value]) => ({ key, value }));
    return this.doc.rows ?? [];
  }
  closeSync() {
    this.closed = true;
  }
  async getFirstAsync(sql: string) {
    return this.getFirstSync(sql);
  }
  async getAllAsync(sql: string) {
    return this.getAllSync(sql);
  }
  async closeAsync() {
    this.closeSync();
  }
}

export const openDatabaseSync = jest.fn((name: string, _opts: unknown, directory: string) => {
  const db = new MemoryDb(join(directory, name));
  fsState.openDbs.push(db);
  return db;
});

export const openDatabaseAsync = jest.fn(async (name: string, opts: unknown, directory: string) =>
  openDatabaseSync(name, opts, directory),
);

/** JSON for a valid offline.db with the given run. */
/** JSON for a valid offline.db with the given run; `pad` adds that many bytes of poorly compressible filler. */
export const dbJson = (run: string, over: { schema?: number; normalizer?: number; check?: string; pad?: number } = {}) =>
  JSON.stringify({
    meta: { offline_schema_version: String(over.schema ?? 1), normalizer_version: String(over.normalizer ?? 3), run },
    check: over.check ?? 'ok',
    rows: [{ run }],
    ...(over.pad ? { pad: filler(over.pad) } : {}),
  });

function filler(n: number): string {
  let x = 2463534242;
  let out = '';
  while (out.length < n) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out += (x >>> 0).toString(36);
  }
  return out.slice(0, n);
}
