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

## `coerceInt(name, fallback, source?)` / `coerceBool(name, fallback, source?)`

The no-Zod escape hatch for the lightweight plain-object pattern. Read one var
with a fallback when absent; **throw loudly** on a present-but-malformed value
(a typo'd number/bool should fail, not silently become `NaN`/`false`).

```ts
import { coerceInt, coerceBool } from "@broberg/config";

const quorum = coerceInt("GF_QUORUM", 3); // throws on "abc" / "1.5"
const live = coerceBool("MAIL_LIVE", false); // true/false/1/0/yes/no/on/off
```

## `productionGuard(config, requiredKeys, nodeEnv?)`

In production, assert that every required key is truthy — so a missing secret
crashes the boot instead of silently shipping a dev default. A no-op elsewhere.

```ts
import { productionGuard } from "@broberg/config";

productionGuard(env, ["RESEND_API_KEY", "AUTH_SECRET"]);
// in production with AUTH_SECRET unset:
//   Error: Missing required production config: AUTH_SECRET
```

## Next.js caveat

`NEXT_PUBLIC_*` vars are **inlined by the bundler at build time** and are absent
from the server runtime's `process.env`. Do **not** route them through
`parseEnv` server-side — reference `process.env.NEXT_PUBLIC_X` directly in
client code, and keep `parseEnv` for true server env (secrets, URLs, flags).

---

Part of the [broberg.ai shared inventory](https://discovery.broberg.ai). Search
before you build: `GET https://discovery.broberg.ai/api/search?q=config`.
