# @broberg/seal

Encrypt the secrets your app must **store and read back** — a customer's own API key (BYOK), an OAuth refresh token, a webhook secret — so a database dump is not a key dump.

- **AES-256-GCM envelope encryption.** Every value gets its own random data key; that key is encrypted with your key ring. Rotating the ring never re-encrypts a payload.
- **A required context (`aad`).** A sealed value is bound to where it belongs, e.g. `${tenantId}:openai-key`. Copied into another row or another customer, it does not open.
- **Key rotation built in.** Add a key version, make it current, `rewrap()` the old values in the background, then remove the old key.
- **Web Crypto only, zero dependencies.** Node 20+, Bun, Deno, Cloudflare/Vercel edge.

```ts
import { createSealer, keysFromEnv } from "@broberg/seal";

const sealer = createSealer({ keys: keysFromEnv(process.env.SEAL_KEYS), current: 1 });

const stored = await sealer.seal(customerKey, { aad: `${tenantId}:openai-key` }); // → "seal1.1.…" — a text column
const key = await sealer.open(stored, { aad: `${tenantId}:openai-key` });
```

## Files and one key per customer (0.2.0)

```ts
// bytes in, bytes out — a 10 MB file is not turned into a 13 MB base64 string
const sealedFile = await sealer.sealBytes(fileBytes, { aad: `${tenantId}:attachment:${id}` }); // → Uint8Array
const fileBytes2 = await sealer.openBytes(sealedFile, { aad: `${tenantId}:attachment:${id}` });

// a key per customer: every key-ring key is derived per scope (HKDF-SHA-256)
const forTenant = createSealer({ keys: keysFromEnv(process.env.SEAL_KEYS), current: 1, scope: tenantId });
```

With `scope`, tenant A's values are never wrapped with the same key as tenant B's: a value sealed for one scope does not open in another, not even with the same key ring and `aad`. The same scope always derives the same key, so a fresh sealer for the tenant opens yesterday's values, and `rewrap()` keeps the scope. Without `scope` nothing changes — values sealed by 0.1.0 open exactly as before. `sealBytes` uses its own binary envelope (`SEB1` · version · wrapped data key · iv · ciphertext); the overhead is fixed and does not grow with the file.

## Keys

```bash
node -e 'import("@broberg/seal").then(m => console.log(m.generateKey()))'   # 32 random bytes, base64
# SEAL_KEYS="1:<base64>"   — a secret (Fly secret / .env), never committed
```

The key ring is `version → key`. Keep it in your secret store (fleet: cardmem's Secrets Vault), never in code or git. Losing every key means losing every sealed value — keep the vault copy.

## Rotation

1. Generate a new key, set `SEAL_KEYS="1:<old>,2:<new>"` and `current: 2`. New values seal under 2; old ones still open.
2. In the background: for every row where `sealer.needsRewrap(value)`, store `await sealer.rewrap(value)`. Only the 32-byte data key is re-encrypted; the payload and its `aad` binding are untouched.
3. When no value needs a rewrap, drop version 1 from `SEAL_KEYS`.

## Errors

Every failure is a `SealError` with a `code`, and no message ever carries a key or the plaintext:

| code | when |
|---|---|
| `invalid` | wrong `aad`, wrong key, or the value was altered |
| `unknown_version` | the value names a key version that is not in the ring (or `current` is missing) |
| `bad_key` | a ring key is not 32 bytes of base64, or `keysFromEnv` got a malformed ring |
| `bad_format` | not a `seal1.…` value |

## Format

`seal1.<keyVersion>.<wrapIv>.<wrappedDataKey>.<iv>.<ciphertext+tag>` — base64url parts. The payload is bound to `seal1|<aad>`, the data-key wrap to `seal1|dek|<keyVersion>`. 96-bit random IVs.

## Not in scope

KMS integration (the key ring comes from your environment), password hashing, signing, incoming API keys (`@broberg/apikey`).
