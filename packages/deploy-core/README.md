# @broberg/deploy-core

The broberg.ai fleet's shared deploy execution layer. It contains exactly two
things:

| Part | What it does |
|---|---|
| **Fly Live** (`flyLiveDeploy`, `syncContent`, `diffManifests`, …) | HMAC-signed incremental content sync to a Fly app, plus the one-time infra build. |
| **`FlyClient`** (since 0.4.0) | The Fly.io API: apps and machines over the Machines REST API, and the GraphQL calls the fleet uses. |

It does **not** contain Cloudflare Pages, GitHub Pages or a deploy-event bus.
Earlier versions of this package's description said it did; the code never had
them (planned in F033.2 / F033.3).

## FlyClient

```ts
import { FlyClient } from "@broberg/deploy-core";
const fly = new FlyClient(); // token from FLY_API_TOKEN, or { token }

await fly.listApps("personal");                 // one org
await fly.listAllApps();                        // every org the token sees, all pages
const [m] = await fly.listMachines("my-app");
await fly.updateMachine("my-app", m.id, {       // resize: pass the WHOLE config
  ...m.config,
  guest: { ...m.config.guest!, memory_mb: 512 },
});
await fly.waitForState("my-app", m.id, "started", 120);
const { state, exitCode } = await fly.waitForExit("my-app", jobId);

await fly.listVolumes("my-app");                // destroyed ones included — filter on state
await fly.promQuery("personal", 'sum(fly_instance_memory_mem_available{app="my-app"})');
```

Also: `getApp`, `createApp`, `deleteApp`, `getMachine`, `createMachine`,
`startMachine`, `stopMachine`, `destroyMachine`, `listOrgs`, `setSecrets`,
`allocateIp`.

### What it does that a hand-rolled client usually does not

Each of these was measured — in a consumer's own copy or against the live API
(24 Sep 2026) — and each has a test that goes red if it is undone:

- **Retries only what can succeed on a second try:** network errors, 408, 429,
  5xx. A 401, 403, 404 or 422 throws at once with `FlyApiError { status, method,
  path }`. (A copy that retried everything turned a wrong token into 30 minutes
  of polling.)
- **`waitForExit` reports `exitCode: null` when Fly recorded none.** It does not
  call that a success; you decide.
- **`waitForExit` throws a 404 for a machine it never saw** (since 0.5.0). Fly
  answers 404 "machine not found" both for a wrong id and for a WRONG TOKEN, so
  a 404 on the first poll is not "destroyed". Only a machine seen in an earlier
  poll that then disappears (auto_destroy) is reported as `destroyed`.
- **`promQuery` hides Fly's Prometheus auth trap** (since 0.5.0). Fly's
  Prometheus answers 401 to `Bearer` and wants `FlyV1 <token>`; the Machines API
  takes Bearer. HTTP 200 with `status: "error"` throws.
- **`waitForState` reads Fly's 408 as "not yet".** Fly's `/wait` answers 408 when
  its own timeout runs out; the client keeps asking until your timeout is spent,
  then throws `FlyTimeoutError`.
- **GraphQL HTTP 200 is not success.** Fly answers 200 for a bad token with the
  error in the body; the client throws a `FlyApiError` with status 401.
- **`listAllApps` is complete or it throws.** It walks every page and checks the
  count against Fly's own `totalCount`. A partial list never looks like a whole
  one — which matters when the caller deletes what is missing from it.
- **The token never appears in an error** message or body.

### Verified against the real Fly API

`test/live/fly-api.live.ts` runs read-only against an existing app (compared
with `flyctl machines list` / `flyctl volumes list`, plus `promQuery` and the
never-seen-machine 404; `FLY_LIVE_READ_ONLY=1` stops there) and runs the write path — create app, create
machine, resize and read back, stop, a process that exits 3, destroy, delete
app — inside a throwaway app it always deletes. Run by hand; it is not part of
`vitest run`.
