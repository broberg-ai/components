# @broberg/config

The fleet's **single-source config helper** — the reusable mechanism behind the
"ALDRIG hardcoded values — one source, trickle down" rule. Validate + type your
environment once at boot, declare typed business constants in one place, and
coerce loose env strings safely. Framework-agnostic (Node · Bun · edge).

`zod` is a **peer dependency** (only the schema _you_ pass touches it):

```bash
npm i @broberg/config zod
```

## `parseEnv(schema, source?)`

Validate + type an env object against a Zod schema, failing fast with a readable
list of every offending key. Call once at boot, export the result, and never
read `process.env` directly afterwards.

```ts
import { z } from "zod";
import { parseEnv } from "@broberg/config";

export const env = parseEnv(
  z.object({
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
    MAIL_LIVE: z.enum(["true", "false"]).default("false"),
  }),
);

env.PORT; // number — coerced + validated
```

A missing/invalid key throws at startup with every problem listed, so the app
never boots in a misconfigured state:

```
Invalid environment configuration:
  - DATABASE_URL: Required
  - PORT: Number must be greater than 0
```

## `defineConfig(config)`

An identity function that brands a plain object as the single typed source for a
set of business constants (fee tiers, shop settings, magic numbers). No runtime
behaviour — it just gives you one typed import boundary so values don't drift.

```ts
import { defineConfig } from "@broberg/config";

export const FEES = defineConfig({ platformPercent: 5, payoutDelayDays: 7 });
```

## `coerceInt` / `coerceNum` / `coerceBool` `(name, fallback, source?)`

The no-Zod escape hatch for the lightweight plain-object pattern. Read one var
with a fallback when absent; **throw loudly** on a present-but-malformed value
(a typo'd number/bool should fail, not silently become `NaN`/`false`).

```ts
import { coerceInt, coerceNum, coerceBool } from "@broberg/config";

const quorum = coerceInt("GF_QUORUM", 3); // integer; throws on "abc" / "1.5"
const ratio = coerceNum("DEPLOY_REGRESSION_MULTIPLIER", 3.0); // float ok; throws on "abc" / "Infinity"
const live = coerceBool("MAIL_LIVE", false); // true/false/1/0/yes/no/on/off
```

## `productionGuard(config, requiredKeys, nodeEnv?, options?)`

In production, assert that every required key is truthy — so a missing secret
crashes the boot instead of silently shipping a dev default. A no-op elsewhere.

```ts
import { productionGuard } from "@broberg/config";

productionGuard(env, ["RESEND_API_KEY", "AUTH_SECRET"]);
// in production with AUTH_SECRET unset:
//   Error: Missing required production config: AUTH_SECRET
```

**What it distinguishes — and what it does not.** By default a key counts as
missing only when its value is *falsy*: unset and `""` are refused, but a
whitespace-only value like `"   "` **passes** — and the service then signs
cookies with three spaces. That default is kept on purpose so no consumer's boot
changes without asking. To also refuse whitespace, pass `blank`:

```ts
const blank = (v: unknown, key: string) =>
  key === "PLATFORM_OWNER_PASSWORD"
    ? !v                                            // human-chosen: space can be real content
    : typeof v !== "string" || v.trim() === "";     // machine-issued: whitespace = not set
productionGuard(env, ["AUTH_SECRET", "PLATFORM_OWNER_PASSWORD"], undefined, { blank });
```

The guard only *asks* whether a value is blank — it never trims or rewrites a
value. A password with surrounding space reaches your app exactly as set.

## Next.js caveat

`NEXT_PUBLIC_*` vars are **inlined by the bundler at build time** and are absent
from the server runtime's `process.env`. Do **not** route them through
`parseEnv` server-side — reference `process.env.NEXT_PUBLIC_X` directly in
client code, and keep `parseEnv` for true server env (secrets, URLs, flags).

## Apps, not libraries

`parseEnv`'s fail-fast belongs in a **consuming app's startup** — not inside a
library or SDK. A library should read keys lazily and stay able to "ship-dark"
with partial/absent keys (e.g. `@broberg/ai-sdk` reads `FAL_KEY ?? FAL_API_KEY`
at call-time and instantiates with stub providers so it works in test/partial-key
environments). Wrapping a library's internal env reads in `parseEnv` would kill
that optional-key / ship-dark behaviour. **Rule:** wrap your *app's* env at boot;
never a dependency's internal reads.

---

Part of the [broberg.ai shared inventory](https://discovery.broberg.ai). Search
before you build: `GET https://discovery.broberg.ai/api/search?q=config`.

## zod ≥ 4.6.6 (security)

zod before 4.6.6 can be made to exhaust memory by one oversized array from the network (GHSA-mrhx-c7xc-m3w5, high). zod 3 is hit too and gets no patch. This package therefore requires zod ≥ 4.6.6 — run `pnpm add zod@^4.6.7` in your app.
