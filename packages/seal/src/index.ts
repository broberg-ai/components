// @broberg/seal — encryption at rest for secrets an app must store AND read back (F102).
//
// Envelope: every value gets its own random data key (DEK, AES-256-GCM); the DEK is encrypted with a
// key-ring key (KEK) whose version travels in the sealed string. Rotating the key ring therefore never
// re-encrypts a payload — rewrap() re-encrypts only the 32-byte DEK.
//
// AAD is REQUIRED: the sealed value is bound to its context (e.g. `${tenantId}:openai-key`), so a value
// copied into another row or another customer cannot be opened there.
//
// Format: seal1.<kekVersion>.<wrapIv>.<wrappedDek>.<iv>.<ciphertext+tag>  (base64url parts)

const PREFIX = "seal1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Why a value could not be sealed or opened. Never carries a key or the plaintext. */
export class SealError extends Error {
  constructor(readonly code: "invalid" | "unknown_version" | "bad_key" | "bad_format", message: string) {
    super(message);
    this.name = "SealError";
  }
}

export interface SealerConfig {
  /** The key ring: version → base64 (or base64url) of 32 random bytes. Build one with generateKey(). */
  keys: Record<number, string>;
  /** The version new values are sealed with. Must be in `keys`. */
  current: number;
}

export interface Sealer {
  /** Encrypt `plaintext` bound to `aad`. A different string every time, even for the same input. */
  seal(plaintext: string, o: { aad: string }): Promise<string>;
  /** Decrypt a sealed value. Throws SealError("invalid") for a wrong aad or any tampering. */
  open(sealed: string, o: { aad: string }): Promise<string>;
  /** True when `sealed` uses a key-ring version other than `current` — rewrap it. */
  needsRewrap(sealed: string): boolean;
  /** Re-encrypt the value's data key under `current`; the payload and its aad binding are not touched. */
  rewrap(sealed: string): Promise<string>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64(s: string): Uint8Array {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(s)) throw new SealError("bad_format", "not base64");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("@broberg/seal needs Web Crypto (globalThis.crypto.subtle)");
  return s;
};
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const aesKey = (raw: Uint8Array) => subtle().importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
async function encrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array, aad: string): Promise<Uint8Array> {
  return new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(aad) as BufferSource }, key, data as BufferSource));
}
async function decrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array, aad: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(aad) as BufferSource }, key, data as BufferSource));
  } catch {
    throw new SealError("invalid", "the value could not be opened: wrong aad, wrong key, or it was altered");
  }
}
// The payload is bound to the CONTEXT only; the key-ring version is bound where it belongs — on the DEK's
// wrap. That is what lets rewrap() touch 32 bytes and never the payload.
const payloadAad = (aad: string) => `${PREFIX}|${aad}`;
const wrapAad = (version: number) => `${PREFIX}|dek|${version}`;

interface Parts { version: number; wrapIv: Uint8Array; wrapped: Uint8Array; iv: Uint8Array; data: Uint8Array }
function parse(sealed: string): Parts {
  const p = typeof sealed === "string" ? sealed.split(".") : [];
  if (p.length !== 6 || p[0] !== PREFIX || !/^\d+$/.test(p[1]!)) throw new SealError("bad_format", "not a seal1 value");
  return { version: Number(p[1]), wrapIv: unb64(p[2]!), wrapped: unb64(p[3]!), iv: unb64(p[4]!), data: unb64(p[5]!) };
}
const join = (version: number, wrapIv: Uint8Array, wrapped: Uint8Array, iv: Uint8Array, data: Uint8Array) =>
  [PREFIX, String(version), b64u(wrapIv), b64u(wrapped), b64u(iv), b64u(data)].join(".");

/** Build a sealer over a key ring. Throws SealError("bad_key") for a key that is not 32 bytes. */
export function createSealer(config: SealerConfig): Sealer {
  const raw = new Map<number, Uint8Array>();
  for (const [v, k] of Object.entries(config.keys)) {
    if (!/^\d+$/.test(v)) throw new SealError("bad_key", `key version «${v}» is not a whole number`);
    let bytes: Uint8Array;
    try { bytes = unb64(k); } catch { throw new SealError("bad_key", `key version ${v} is not base64`); }
    if (bytes.length !== KEY_BYTES) throw new SealError("bad_key", `key version ${v} is ${bytes.length} bytes, not ${KEY_BYTES}`);
    raw.set(Number(v), bytes);
  }
  if (!raw.has(config.current)) throw new SealError("unknown_version", `current version ${config.current} is not in the key ring`);
  const keks = new Map<number, Promise<CryptoKey>>();
  const kek = (v: number) => {
    const bytes = raw.get(v);
    if (!bytes) throw new SealError("unknown_version", `key version ${v} is not in the key ring`);
    if (!keks.has(v)) keks.set(v, aesKey(bytes));
    return keks.get(v)!;
  };
  const unwrap = async (p: Parts) => decrypt(await kek(p.version), p.wrapIv, p.wrapped, wrapAad(p.version));

  return {
    async seal(plaintext, o) {
      if (typeof plaintext !== "string") throw new TypeError("seal() takes a string");
      if (typeof o?.aad !== "string" || !o.aad) throw new TypeError("seal() needs { aad } — the context the value belongs to");
      const v = config.current;
      const dek = random(KEY_BYTES);
      const iv = random(IV_BYTES);
      const wrapIv = random(IV_BYTES);
      const data = await encrypt(await aesKey(dek), iv, enc.encode(plaintext), payloadAad(o.aad));
      const wrapped = await encrypt(await kek(v), wrapIv, dek, wrapAad(v));
      return join(v, wrapIv, wrapped, iv, data);
    },
    async open(sealed, o) {
      if (typeof o?.aad !== "string" || !o.aad) throw new TypeError("open() needs { aad }");
      const p = parse(sealed);
      const dek = await unwrap(p);
      return dec.decode(await decrypt(await aesKey(dek), p.iv, p.data, payloadAad(o.aad)));
    },
    needsRewrap(sealed) {
      return parse(sealed).version !== config.current;
    },
    async rewrap(sealed) {
      const p = parse(sealed);
      if (p.version === config.current) return sealed;
      const dek = await unwrap(p);
      const v = config.current;
      const wrapIv = random(IV_BYTES);
      return join(v, wrapIv, await encrypt(await kek(v), wrapIv, dek, wrapAad(v)), p.iv, p.data);
    },
  };
}

/** 32 random bytes, base64 — one key-ring entry. */
export function generateKey(): string {
  return btoa(String.fromCharCode(...random(KEY_BYTES)));
}

/** Parse a key ring from one env value: "1:<base64>,2:<base64>". Throws SealError("bad_key") on a malformed entry. */
export function keysFromEnv(value: string | undefined): Record<number, string> {
  if (!value?.trim()) throw new SealError("bad_key", "no keys given");
  const keys: Record<number, string> = {};
  for (const entry of value.split(",")) {
    const m = entry.trim().match(/^(\d+):([A-Za-z0-9+/_=-]+)$/);
    if (!m) throw new SealError("bad_key", "a key-ring entry is not <version>:<base64>");
    keys[Number(m[1])] = m[2]!;
  }
  return keys;
}
