// F111.2 — the browser half. Sends the file in parts DIRECTLY to the bucket using
// URLs the site's server signed; the site's server never sees a byte. Remembers
// finished parts so a dropped connection resumes instead of starting over.

export interface UploadProgress {
  sentBytes: number;
  totalBytes: number;
  /** 0–100 */
  percent: number;
  /** Measured over the last ~10 s. */
  bytesPerSecond: number;
  /** null until there is a speed to estimate from. */
  secondsLeft: number | null;
  partsDone: number;
  partsTotal: number;
}

export interface UploadOptions {
  /** The site's route that runs createS3Handler, e.g. "/api/s3". */
  endpoint: string;
  /** Parts in flight at once. Default 4. */
  concurrency?: number;
  /** Attempts per part before giving up. Default 5. */
  retries?: number;
  onProgress?(p: UploadProgress): void;
  /** Aborting PAUSES: finished parts are kept and the next uploadFile on the same file resumes. */
  signal?: AbortSignal;
  /** Extra headers for calls to `endpoint` (e.g. a CSRF token). Cookies are sent (same-origin). */
  headers?: Record<string, string>;
  /** Where resume state lives. Default localStorage when present; null disables resume. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  /** Injected for tests. */
  fetch?: typeof fetch;
}

export interface UploadResult { key: string; size: number }

export class UploadError extends Error {
  constructor(message: string, readonly code: string, readonly status?: number) {
    super(message);
    this.name = "UploadError";
  }
}

type FileLike = Blob & { name?: string; lastModified?: number };

interface ResumeRecord { key: string; uploadId: string; partSize: number; partCount: number; parts: Record<number, string> }

const defaultStorage = () => {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
};

export const resumeId = (endpoint: string, file: FileLike) =>
  `broberg-s3:${endpoint}:${file.name ?? "blob"}:${file.size}:${file.lastModified ?? 0}`;

async function api<T>(opts: UploadOptions, body: Record<string, unknown>): Promise<T> {
  const f = opts.fetch ?? fetch;
  const res = await f(opts.endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...opts.headers },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
  if (!res.ok) throw new UploadError(data.error?.message ?? `upload service answered ${res.status}`, data.error?.code ?? "http_error", res.status);
  return data as T;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });

/** Upload `file`; resumes automatically if an earlier attempt on the same file was interrupted. */
export async function uploadFile(file: FileLike, opts: UploadOptions): Promise<UploadResult> {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const id = resumeId(opts.endpoint, file);
  const save = (r: ResumeRecord) => { try { storage?.setItem(id, JSON.stringify(r)); } catch { /* quota: resume is best-effort, upload continues */ } };
  const f = opts.fetch ?? fetch;

  let rec: ResumeRecord | null = null;
  const raw = storage?.getItem(id);
  if (raw) {
    try {
      const old = JSON.parse(raw) as ResumeRecord;
      // The bucket is the truth: ask which parts it actually holds.
      const { parts } = await api<{ parts: { partNumber: number; etag: string }[] }>(opts, { action: "list", key: old.key, uploadId: old.uploadId });
      rec = { ...old, parts: Object.fromEntries(parts.map((p) => [p.partNumber, p.etag])) };
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      storage?.removeItem(id); // expired or foreign upload: start fresh
    }
  }
  if (!rec) {
    const s = await api<{ key: string; uploadId: string; partSize: number; partCount: number }>(opts, {
      action: "start", filename: file.name ?? "file", size: file.size, type: file.type || "application/octet-stream",
    });
    rec = { ...s, parts: {} };
    save(rec);
  }
  const r = rec;

  const partBytes = (n: number) => Math.min(r.partSize, file.size - (n - 1) * r.partSize);
  let sent = Object.keys(r.parts).reduce((s, n) => s + partBytes(Number(n)), 0);
  const samples: Array<[number, number]> = [[Date.now(), sent]];
  const report = () => {
    const now = Date.now();
    samples.push([now, sent]);
    while (samples.length > 2 && now - samples[0]![0] > 10_000) samples.shift();
    const [t0, b0] = samples[0]!;
    const bps = now > t0 ? ((sent - b0) * 1000) / (now - t0) : 0;
    opts.onProgress?.({
      sentBytes: sent, totalBytes: file.size, percent: file.size ? (sent / file.size) * 100 : 100,
      bytesPerSecond: bps, secondsLeft: bps > 0 ? (file.size - sent) / bps : null,
      partsDone: Object.keys(r.parts).length, partsTotal: r.partCount,
    });
  };
  report();

  const queue = Array.from({ length: r.partCount }, (_, i) => i + 1).filter((n) => !r.parts[n]);
  const retries = opts.retries ?? 5;

  async function sendPart(n: number) {
    for (let attempt = 1; ; attempt++) {
      opts.signal?.throwIfAborted(); // pause is honoured here even if a transport ignores the signal
      try {
        const { urls } = await api<{ urls: { partNumber: number; url: string }[] }>(opts, { action: "sign", key: r.key, uploadId: r.uploadId, partNumbers: [n] });
        const start = (n - 1) * r.partSize;
        const res = await f(urls[0]!.url, { method: "PUT", body: file.slice(start, start + partBytes(n)), signal: opts.signal });
        if (!res.ok) throw new UploadError(`storage answered ${res.status} for part ${n}`, "part_failed", res.status);
        const etag = res.headers.get("etag");
        if (!etag) throw new UploadError("the bucket did not expose the ETag header — its CORS rule needs ExposeHeaders: ETag", "cors_etag", 0);
        r.parts[n] = etag;
        sent += partBytes(n);
        save(r);
        report();
        return;
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        if (e instanceof UploadError && (e.code === "cors_etag" || (e.status !== undefined && e.status >= 400 && e.status < 500 && e.code !== "part_failed"))) throw e;
        if (attempt >= retries) throw e;
        await sleep(Math.min(30_000, 500 * 2 ** attempt), opts.signal);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, queue.length)) }, async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) await sendPart(n);
  });
  await Promise.all(workers);
  opts.signal?.throwIfAborted();

  const parts = Object.entries(r.parts).map(([n, etag]) => ({ partNumber: Number(n), etag })).sort((a, b) => a.partNumber - b.partNumber);
  const done = await api<UploadResult>(opts, { action: "complete", key: r.key, uploadId: r.uploadId, parts });
  storage?.removeItem(id);
  return done;
}

/** Stop an interrupted upload for good: the bucket discards its parts and resume state is cleared. */
export async function cancelUpload(file: FileLike, opts: Omit<UploadOptions, "signal">): Promise<void> {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const id = resumeId(opts.endpoint, file);
  const raw = storage?.getItem(id);
  if (!raw) return;
  const rec = JSON.parse(raw) as ResumeRecord;
  storage?.removeItem(id);
  await api(opts, { action: "abort", key: rec.key, uploadId: rec.uploadId });
}

/** A short-lived signed link to download `key` (which must be under your prefix). */
export async function downloadUrl(key: string, opts: Pick<UploadOptions, "endpoint" | "headers" | "fetch"> & { filename?: string }): Promise<string> {
  const { url } = await api<{ url: string }>(opts, { action: "download", key, filename: opts.filename });
  return url;
}

export interface ListedFile { key: string; size: number; lastModified: string; metadata?: Record<string, string> }
export interface ListedUpload { key: string; uploadId: string; initiated: string; sentBytes: number; totalBytes?: number; filename?: string; metadata?: Record<string, string> }

/** Files you have received (under your prefix). `metadata: true` adds who sent it — one extra request per file. */
export async function listFiles(opts: Pick<UploadOptions, "endpoint" | "headers" | "fetch"> & { metadata?: boolean }): Promise<ListedFile[]> {
  return (await api<{ objects: ListedFile[] }>(opts, { action: "objects", metadata: opts.metadata === true })).objects;
}

/** Uploads under your prefix that are still under way: «sentBytes of totalBytes», and who started them. */
export async function listUploads(opts: Pick<UploadOptions, "endpoint" | "headers" | "fetch">): Promise<ListedUpload[]> {
  return (await api<{ uploads: ListedUpload[] }>(opts, { action: "uploads" })).uploads;
}
