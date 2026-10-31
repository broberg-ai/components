# @broberg/sso

The thin client for **BrobergID** (`id.broberg.ai`). Send a user to central
login, verify the ID token against JWKS, keep a local session. That is all it
does, and the list of what it deliberately cannot do is part of the design.

```bash
pnpm add @broberg/sso
```

**Version numbers below say WHICH HALF they apply to, because the two move at
different speeds.** The core (`createSsoClient`, `signValue`/`verifyValue`) and
the Hono adapter (`ssoRoutes`) gained the same capability in different releases
more than once, and a single number per section quietly told adapter users they
already had something they did not:

| | core | Hono adapter |
|---|---|---|
| server-enforced cookie age | 0.2.3 | 0.2.3 |
| two lifetimes, three distinct callback errors | *yours to write* | **0.3.0** |

Reported by broberg-id, who found the same contradiction in their own guide:
a floor of 0.2.3 beside "the adapter gives you this for free". **A floor that is
too low is not merely out of date — next to a "you get it for free" it becomes
advice not to check.**

## Configure it with environment variables only

```bash
BID_ISSUER=https://id.broberg.ai        # the BARE origin
SSO_CLIENT_ID=my-app                    # registered administratively in BID
SSO_REDIRECT_URI=https://my.app/auth/callback   # EXACT match, one slash decides
SSO_COOKIE_SECRET=$(openssl rand -hex 32)
# optional
SSO_SCOPES="openid profile email"
SSO_COOKIE_NAME=bid_session
SSO_SESSION_PROFILE=standard            # or "sensitive" — see below (0.24.0)
SSO_POST_LOGOUT_REDIRECT_URI=https://my.app/
```

## How long a login lasts — one knob, the owner's numbers (0.24.0, F084.163)

| `SSO_SESSION_PROFILE` (or `ssoRoutes({ sessionProfile })`) | the session |
|---|---|
| `standard` (default) | 7 days, **renewed on every use** — a user active once a week never logs in again |
| `sensitive` | ends after **30 minutes without use**, and **12 hours after login** however active |

**Handling personal or health data? Set `SSO_SESSION_PROFILE=sensitive`.** The
numbers are the owner's (Decision Register D-38a092) and live in one place,
`SESSION_PROFILES`; there is no way to give your own.

**BREAKING in 0.24.0 — `SSO_SESSION_MAX_AGE` and `config.sessionMaxAge` are gone,
and setting either now THROWS at boot** rather than being ignored: an app that
had `SSO_SESSION_MAX_AGE=43200` for patient data must not silently fall back to
7 days. Replace it with `SSO_SESSION_PROFILE=sensitive`. And `standard` changed
meaning: 0.23 counted 7 days from LOGIN, 0.24 counts 7 days from LAST USE.

**The hourly silent check.** With a `tokenStore` and a refresh token (your BID
registration has `offline_access` and your `SSO_SCOPES` asks for it — see the
token store section), every live session asks BID once an hour whether the BID
login still stands, by renewing its refresh token (`grant_type=refresh_token`,
`credentials: "omit"`). BID refuses once that login has ended — «Log ud»,
«Log ud overalt», a new password, expiry — and the app session ends on the next
request. So an app whose back-channel logout endpoint was down is still logged
out within an hour. **BID being down never logs anyone out**: a 5xx, a network
error or an unreadable answer keeps the session, and the check retries after a
minute. Without a refresh token nothing changes from 0.23.

**The tokens are encrypted before your store sees them** (AES-256-GCM, key
derived from `SSO_COOKIE_SECRET`, stored as `enc:v1:…`). Rows written by 0.23 are
plaintext and are read as they are, then sealed on their next write — upgrading
logs nobody out. Rotating `SSO_COOKIE_SECRET` makes stored tokens unreadable,
which the app treats as "no tokens" (the same as before rotation for the cookie).

## What the token exchange tells you when it fails (0.2.3)

`completeLogin` throws `SsoError` with a message written to stand ALONE in a log
line — because that is usually all you have. BID's own guide tells you to catch
the throw and redirect rather than return a 500, so the user sees a redirect and
the only diagnosis is what you logged.

```
token exchange failed (400): invalid_grant — invalid code
token exchange failed (502): the response body is not JSON (content-type: text/html) — <!doctype html> …
```

The second form is new in 0.2.3. Before it, a non-JSON response threw a raw
`SyntaxError: Unexpected end of JSON input` — no status, nothing naming the
issuer — which sends the reader into their own code to look for a fault that is
in the server. The excerpt is one line, capped at 200 characters, and your own
`client_secret` is redacted out of it if the server echoes it back.

## Cookie lifetimes: the server's opinion, not only the browser's (0.2.3)

`signValue` / `verifyValue` take an optional `maxAgeSeconds`:

```ts
const cookie = await signValue(value, secret, { maxAgeSeconds: 300 });
const back   = await verifyValue(cookie, secret, { maxAgeSeconds: 300 }); // null once too old
```

Without it, behaviour is unchanged: signature only, lifetime enforced solely by
the cookie's `Max-Age`. That default is deliberate — making the check mandatory
would invalidate every cookie already sitting in a user's browser.

Four cases worth knowing:

| signed | verified | result |
|---|---|---|
| without a limit | without a limit | valid, as before |
| with a limit | with a limit | valid inside the window, `null` past it |
| **without a limit** | **with a limit** | **`null` — fails closed** |
| **with a limit** | **without a limit** | **valid forever — the limit is never checked** |

The third is the rollout case, and it fails closed on purpose: otherwise a value
minted by an older build would be the way around the limit you just added.

**The fourth is the one that will catch you, because it looks done.** The limit
lives in `verifyValue`, not in `signValue` — a timestamp nobody reads back is
just four extra bytes in the cookie. So passing `maxAgeSeconds` where you mint
the value and forgetting it where you read it leaves you exactly where you
started, with a stamped cookie, no error, and nothing to look at. **Pass it in
both ends, from one constant.**

The timestamp is inside the signed body, so it cannot be edited by whoever holds
the cookie. The package's own Hono adapter now passes `maxAgeSeconds` on the
login-transaction cookie, with the same constant that sets its `Max-Age`.


## Mount it (Hono)

```ts
import { Hono } from "hono";
import { ssoRoutes, getSession } from "@broberg/sso/hono";

const app = new Hono();
const sso = ssoRoutes({ loginPath: "/auth" });

app.route("/auth", sso.app);          // /auth/login · /auth/callback · /auth/logout
app.use("*", sso.attach);             // read the session, never block
app.get("/me", sso.require, (c) => c.json(getSession(c)));  // block + redirect
```

That is the whole integration. No other code changes.

## Using the core instead — and the two things you then own

The adapter above mints **its own** session cookie, keyed on BrobergID's `sub`.
That is right for a NEW app and wrong for an app that already has a user table
and a session keyed on its own id — you would end up with two cookies and two
opinions about who is logged in. **That is the common case in a migration, not
the exception**, and the first real consumer (HelpDesk, BID's app #1) hit it on
day one and chose the core.

Take the core, and the package stays out of your storage entirely:

```ts
import { createSsoClient, loadSsoConfig } from "@broberg/sso";

const client = createSsoClient(loadSsoConfig());
const { claims, idToken } = await client.completeLogin({ … });
// your session, your cookie, your secret, your lifetime — keyed on YOUR user id
```

### 1. Storing the ID token

Not an afterthought — without it the issuer MUST show the user a confirmation
page on the way out, which is a foreign, unstyled page in the middle of your
product:

```ts
// at callback: keep it wherever you keep your own session
await myStore.put(userId, idToken);

// at logout: hand it back, or the issuer asks the user to confirm
const url = await client.logoutUrl({ idTokenHint: await myStore.get(userId) });
```

`idTokenHint` is optional and a missing one is safe — you simply get the old
behaviour (the issuer asks) rather than an error. So this fails quietly, which
is exactly why it is written here instead of left to be discovered.

**Or decide not to log out of BrobergID at all — that is the other valid
shape, not a lesser one.** HelpDesk clears only its own session cookie and never
redirects to the issuer's end-session endpoint. Then there is no foreign
confirmation page to get past and no `idTokenHint` to be missing, and you need
none of the code above. The consequence is real and worth choosing on purpose
rather than discovering: **signing out of your app leaves the BrobergID session
alive**, so signing back in happens without a prompt. That is right for an app
on a shared product surface and wrong for a kiosk.

### 2. The login flow cookie's lifetime (core: 0.2.3 · adapter: 0.3.0)

`beginLogin()` hands you `state`, `codeVerifier` and `nonce` and then forgets
them — where they live between the redirect and the callback is yours. Put them
in a cookie signed with `signValue`, and **the cookie's `Max-Age` is the only
thing limiting how long that flow stays usable. `Max-Age` is the browser's
promise, and a client can simply decline to make it**: the server will accept a
correctly-signed flow value forever.

```ts
const FLOW_WINDOW  = 300;               // the SERVER's limit — the real one
const COOKIE_LIFE  = FLOW_WINDOW * 3;   // the BROWSER's — deliberately longer

// at /login
setCookie("my_flow", await signValue(tx, secret, { maxAgeSeconds: FLOW_WINDOW }),
          { maxAge: COOKIE_LIFE, httpOnly: true, secure: true, sameSite: "Lax" });

// at /callback
const tx = await verifyValue(cookie, secret, { maxAgeSeconds: FLOW_WINDOW });
if (tx === null) return expiredOrNotOurs();   // and clear the cookie
```

### Two numbers, not one — and the second is the one people delete

The obvious simplification is to use one constant for both. Do not: **a cookie
the browser has already dropped NEVER ARRIVES.**

| cookie `Max-Age` | what your server sees once the window has passed |
|---|---|
| = the window | **nothing.** The browser stopped sending it |
| > the window | a too-old transaction, which you can name |

With one number you cannot tell *"she took too long"* from *"she never started a
login here"* — different things, different answers to the user, and one of them
is a bug in your app while the other is not.

**The extra browser time buys diagnosis, not lifetime.** The read end still
refuses anything past `FLOW_WINDOW` and clears the cookie, so a verifier that
cannot be exchanged is not a key. Measured counter-example from helpdesk, who
run 3× in production; this package's own Hono adapter now does the same, after
answering every failed callback with one message containing the word *"or"*.

**Mount the Hono adapter on 0.3.0 or later and you get all of this for free** —
the signed window, the longer cookie, and three distinct causes
(`expired` · `absent` · `unreadable`). **Since 0.12.0 the browser no longer sees
all three by default**: see *What a refused login tells the browser* below. **On 0.2.3–0.2.5
the adapter had the signed window but still used ONE number for both**, so it
answered every failed callback with a single message containing the word *"or"*.
Take the core and nothing is passed on your behalf, on any version. Reported by broberg-id, who found their own framework-free
example promising a lifetime the code did not enforce: the comment said a
forgotten cookie could not be reused tomorrow, and for anyone holding the value
itself, it could.

**Use `loadSsoConfig()` rather than building the config object yourself.** It is
the only thing that throws `SsoConfigError` on a missing or blank value, naming
the variable. Hand-build the object from your own env schema and a blank string
is a valid, empty config that fails much later and somewhere else.

## Checking a token someone else holds — `introspectToken` (0.17.0, F084.158)

When a client app (a browser extension, a native app) logs in with BID and calls YOUR backend with its access token, your backend asks BID whether that token is good — RFC 7662 introspection, with your app's own client id and secret:

```ts
const sso = createSsoClient(loadSsoConfig());
try {
  const t = await sso.introspectToken(bearer, { requireClientId: "trail-clipper", cacheMs: 30_000 });
  // t = { active: true, sub, clientId, scope, exp } — serve t.sub's own data only
} catch (e) {
  if (e instanceof SsoTokenInactiveError) return c.json({ error: "login_required" }, 401);          // inactive, wrong client, expired
  if (e instanceof SsoIntrospectionUnavailableError) return c.json({ error: "bid_unavailable" }, 503); // BID down / timeout / our credentials refused
  throw e;
}
```

- **Two failures, never confused.** A BID hiccup must not log a user out, and an expired login must not be retried as if BID were down.
- **`requireClientId`** is the check that matters: BID user tokens carry no per-app audience today, so "issued to the clipper client" is what proves the call came from your clipper.
- **Needs `SSO_CLIENT_SECRET`** — a public client cannot introspect. Since 0.18.0 (F084.160) that is `SsoConfigError`, thrown before any request (0.17.0 called it `SsoIntrospectionUnavailableError`, which sent callers down the 503-and-retry path for a fault that never goes away). Answer 500 and fix the setup; never retry. A wrong secret is reported as unavailable with "client id/secret was refused" — measured against id.broberg.ai.
- **Cache** (optional, `cacheMs`): an active answer is reused up to that long and never past the token's `exp`; an inactive answer is never cached. The token itself never appears in an error message.

## Login and signup in YOUR design — `client.embedded` (0.19.0, F084.165)

For an app BID has allowed to draw its own login (BID F084.166 v1.1 + F084.167 — owner's exception,
Jam first). Runs on YOUR SERVER as a confidential client (`clientSecret` required — BID gets
`Authorization: Basic client_id:client_secret`). Ends in the SAME `LoginResult` as `completeLogin`,
so your `signSession` step does not change.

```ts
const s = await client.embedded.start({ email, endUserIp, intent: "signup", name, termsVersion }); // intent/name/termsVersion only for signup
if (s.ok) setCookie("bid_flow", await sealEmbeddedFlow(s.flow, cookieSecret), { httpOnly: true, maxAge: EMBEDDED_FLOW_MAX_AGE });
// later, with the code from the mail:
const f = await openEmbeddedFlow(getCookie("bid_flow"), cookieSecret);           // { ok, flow } | { ok:false, reason: absent|expired|unreadable }
const step = f.ok ? await client.embedded.verify(f.flow, code) : null;          // done → step.result is a LoginResult
// second_factor → client.embedded.sendSms(flow) / verifySecondFactor(flow, "totp"|"sms", code)
const terms = await client.embedded.terms("da");                                // show terms.text + links VERBATIM at the signup button
```

- The PKCE verifier and nonce stay server-side in the sealed flow cookie (10 min, same signing as the login
  transaction); the id_token's `nonce` must match the flow's, or `verify` throws.
- Errors are data: `invalid_code {attemptsLeft}`, `expired`, `locked {retryAfter}`, `too_many_requests {retryAfter}`,
  `not_embedded` (403/404 — fall back to the normal redirect login), `signup_not_enabled`, `terms_outdated {version}`
  (re-fetch `terms()`), `invalid_request`, `unavailable`.
- A 401 from BID is YOUR configuration (wrong client id/secret) and THROWS `SsoError` — it is never shown to the
  user as a wrong code.
- **Passkey offer (0.20.0, BID F084.178).** When the user has no passkey, a `done` step also carries
  `passkeySetup: { setupId, frameUrl, expiresIn }`. Show `frameUrl` in an `<iframe allow="publickey-credentials-create">`.
  `frameUrl` is always on the issuer's own origin — an offer pointing anywhere else is dropped, not passed on.
  No offer → the step is exactly `{ kind: "done", result }` as before.
- **The app's name on the terms (0.20.0, BID F084.177).** `terms(lang)` sends your `client_id`, so BID's consent text
  can say «hos <your app>».

## Face ID / fingerprint login from a native app — `@broberg/sso/native` (0.22.0, F084.185)

A Capacitor app (iOS or Android) logs in with the phone's passkey through BID's embedded passkey flow. This entry runs **on the device** as a public client — PKCE, no client secret, no dependencies (only `fetch` and Web Crypto) — so it does not pull the server client into the app.

```ts
import { nativePasskeyLogin, NativePasskeyPlatformError } from "@broberg/sso/native";

const r = await nativePasskeyLogin({
  baseUrl: "https://id.broberg.ai",
  clientId: "buzz-ios",               // registered with BID as a native client (iOS app id / Android package + SHA-256)
  getAssertion: async (options) => {  // YOUR Capacitor passkey plugin — this package does not pick one
    // options = { challenge, rpId: "id.broberg.ai", timeout, userVerification: "required" }
    // return a standard AuthenticationResponseJSON (id, rawId, type, response.{clientDataJSON, authenticatorData, signature, userHandle}, base64url)
    // throw new NativePasskeyPlatformError("no_credential") when the phone has no passkey for BID
  },
});
if (r.ok) saveSecurely(r.tokens);     // tokens are returned, never stored by the package
else switch (r.reason) { case "cancelled": case "no_credential": case "rejected": case "unavailable": /* … */ }
```

- **Discoverable credentials only** — BID sends no `allowCredentials`; the passkey the user picks decides the account.
- **`userVerification: "required"` is set by the package**, so no app can ask the platform for a passkey without Face ID / fingerprint / PIN.
- Five outcomes, kept apart because they need different answers: `cancelled` (user closed the prompt), `no_credential` (no passkey on this phone), `platform_failed` (the phone's passkey system itself failed — e.g. iOS error 1004, the app is not associated with id.broberg.ai; a setup fault, log `message`), `rejected` (BID refused: unknown/unregistered client, bad or expired assertion, locked after too many tries), `unavailable` (BID did not answer). Nothing throws.
- An error your `getAssertion` throws WITHOUT classifying it is read by name: `NotAllowedError` / `AbortError` → `cancelled`, anything else → `platform_failed` (0.23.0; 0.22.0 called every unknown error «cancelled», which hid a real setup fault as «you cancelled»).
- Verify the returned `id_token` where you trust the result (your server), as with any login.

## What it will never do

No passwords. No passkey registration. No social-provider keys. No email
verification. **No client secret** — it is a public client and PKCE carries the
exchange.

That last one is safe for a specific, measured reason rather than a hopeful
one: BID matches redirect addresses exactly (a single trailing slash is
refused), so an authorization code is delivered to your own server and nowhere
else. An attacker who knows your client id can start a flow; they cannot
receive its result. And a secret that does not exist cannot be committed,
logged, copied into a second app, or left in a repo someone later opens.

## Key rotation costs you nothing

The key cache refetches when it sees an **unknown key id** — not on a timer. A
timer is a guess about when somebody else will rotate; an unknown kid is the
event itself. Refetches are rate-limited (10s by default) so a stream of tokens
with invented kids cannot be used to aim traffic at BID.

## One thing that is load-bearing and easy to undo

The session cookie is `SameSite=Lax`, not `Strict`. The callback from BrobergID
is a top-level navigation from another site, and `Strict` withholds the cookie
on exactly that navigation — every sign-in would fail with "state does not
match", which sends you looking at the OAuth flow instead of at a cookie flag.

## Licence

MIT

## Does this address belong to the user? (since 0.4.0)

```ts
const answer = await client.addressOwnership(accessToken, "a@example.dk");
// "verified"        on the user's BID account and verified there
// "unverified"      on the account, not verified
// "not_on_account"  not on this user's account
```

Calls BID's `POST /api/app/address-ownership` with the user's access token. **It throws `SsoError` on anything else** — a non-2xx, a body that is not JSON, a missing or unknown status. Do not catch that into `"unverified"`: an error means *we do not know*, and treating it as "not verified" quietly downgrades a real user.

## Inviting users and tracking the move to BID (since 0.5.0)

Two calls that authenticate with **your app's own key** (`bidk_…`, issued by BrobergID) — not the client secret, not a user's token.

```ts
const results = await client.inviteUsers(process.env.BID_APP_KEY!, {
  customerName: "Sanne Andersen",
  appUrl: "https://sanneandersen.dk",
  appName: "CMS",               // optional
  switchDate: "2026-10-15",     // optional
  users: [{ email: "sanne@example.dk", name: "Sanne" }],   // max 500 per call
});
// [{ email, outcome: "invited" | "already_invited" | "existing" | "invalid"
//                   | "too_soon" | "too_many_today" | "send_failed", mailId?, problem? }]

const status = await client.migrationStatus(process.env.BID_APP_KEY!, ["sanne@example.dk"]);
// { users: [{ email, state: "ready" | "invited" | "expired" | "not_invited", expiresAt? }], counts, complete }
```

**Both throw `SsoError`** on a non-2xx (a refused key says `invalid_app_key`), a body that is not JSON, a missing array, or an outcome/state this client does not know. **Never treat an error as `"ready"`**: switching off a user's old login because BID's answer was unclear is how someone gets locked out.

**Timeout.** `addressOwnership`, `inviteUsers` and `migrationStatus` give up after `timeoutMs` (default 10 000) with `SsoError`, so a hanging BID cannot hang your app: `createSsoClient(config, { timeoutMs: 5_000 })`.

## «Log ud overalt» — receiving it from BID (since 0.6.0)

When a user presses **«Log ud overalt»** in BrobergID, BID tells every app it has registered for that: an OIDC Back-Channel Logout token to `POST <mount>/backchannel-logout`. The ordinary «Log ud» in BID does **not** reach your app (owner decision D-376ffa), and the package refuses a token carrying `sid` to keep it that way.

```ts
const sso = ssoRoutes({
  backchannel: {
    store,                    // REQUIRED — shared by every instance of the app
    onStoreError: "reject",   // default: if the store is down, treat the user as logged out
  },
});
app.route("/auth", sso.app);  // → POST /auth/backchannel-logout; give BID that exact URL
```

**The store is yours, and it must be shared.** Your app runs on more than one machine; a list kept in memory would log the user out on one and not the other. There is no in-memory default — `ssoRoutes` throws at startup without a store. A table in the database you already have is enough:

```ts
// CREATE TABLE sso_logout (sub TEXT PRIMARY KEY, before INTEGER NOT NULL);
// CREATE TABLE sso_logout_jti (jti TEXT PRIMARY KEY, until INTEGER NOT NULL);
const store: BackchannelStore = {
  async revokeSubBefore(sub, iat) {
    await db.execute({ sql: `INSERT INTO sso_logout (sub, before) VALUES (?, ?)
      ON CONFLICT(sub) DO UPDATE SET before = MAX(before, excluded.before)`, args: [sub, iat] });
  },
  async revokedBefore(sub) {
    const r = await db.execute({ sql: "SELECT before FROM sso_logout WHERE sub = ?", args: [sub] });
    return r.rows[0] ? Number(r.rows[0].before) : null;
  },
  async useJti(jti, until) {
    const r = await db.execute({ sql: "INSERT OR IGNORE INTO sso_logout_jti (jti, until) VALUES (?, ?)", args: [jti, until] });
    return r.rowsAffected === 1;   // false = a replay: answered 200, no new effect
  },
};
```

What happens: a verified token → `revokeSubBefore(sub, iat)` → from then on `attach`/`require` look up the user and refuse every session minted at or before that moment (sessions from before 0.6.0 carry no timestamp and count as older). A session started after the logout is untouched. Invalid tokens → 400; store down while receiving → 503, so BID can tell the user this app did not log out.

**Nothing arrives until BID has registered your URL** — mounting it early is safe (ship dark). Tell broberg-id the exact URL once it is deployed.

**The cost:** one store lookup per request that goes through `attach`/`require`.

## «Log ud» in your app (changed in 0.7.0)

**`GET /logout` now logs the user out of YOUR app only, and shows BID's login dialog.** It clears the app's session and sends the browser to `<mount>/login?prompt=login`; BID then shows its dialog even though the user is still signed in to BID. The user can pick another account or just sign in again. Their BID session, and every other app, are untouched: logging out of BID itself is BID's own «Log ud» (owner decision D-376ffa), and «Log ud overalt» is the button in BID for ending everything.

Up to 0.6.x, `/logout` sent the user to BID's end-session endpoint, which also ended the BID session. Keep that behaviour with:

```ts
ssoRoutes({ logout: "central" });
```

`/login?prompt=login` and `/login?prompt=none` are passed on to BID; any other prompt is dropped.

## email_verified on the session (since 0.7.0)

`getSession(c).email_verified` is `true` or `false` when BID said so, and absent when it did not. Sessions minted before 0.7.0 have no such field; treat absent as not verified.

> **On BID today, `email` and `email_verified` are NOT signed.** BID's ID token does not carry them — measured by broberg-id on 20 Sep 2026 against the real service: the token holds `acr · at_hash · aud · auth_time · exp · iat · iss · nonce · sid · sub`, and email + email_verified exist only in the `/oauth2/userinfo` response, which is plain HTTP with no signature. `email_verified === true` is still the right thing to require before linking on an address, but it is BID's word over TLS, not a signed claim.
>
> **If a decision must rest on a signed identity, bind on `sub`** (`session.sub`) — the ID token signs it, and the package refuses a userinfo answer whose `sub` differs. helpdesk moved its account linking from email to `sub` for exactly this reason.

## Which claims were signed — `unverifiedClaims` (since 0.8.0)

`completeLogin()` returns `unverifiedClaims: string[]` beside `claims`: the claims that came from the unsigned userinfo response and not from the signed ID token, sorted. Against BID today it is `["email", "email_verified", "name", …]`. An empty list means everything in `claims` was signed, or userinfo was not reached.

When both sources carry a claim, **the signed token's value wins** and the claim is not listed. Before 0.8.0 userinfo was spread over the token, so an issuer whose userinfo disagreed with its own token had the unsigned value win. Against BID this changes nothing today — the two never overlap on email — so for BID it is a hardening, not a fix.

## Calling BID as the user — the token store (since 0.9.0)

The login already receives an **access token** and a **refresh token**. Give
`ssoRoutes` a `tokenStore` and they are kept **server-side**, so your app can
call BID's app API as the user — the account page (read and change your own
name and picture) is the first thing that needs it.

```ts
import { ssoRoutes } from "@broberg/sso/hono";
import type { TokenStore } from "@broberg/sso";

const tokenStore: TokenStore = {            // backed by YOUR database (SQLite, Postgres, Redis …)
  get: (sid) => db.tokens.get(sid),
  set: (sid, t) => db.tokens.put(sid, t),   // t = { sub, accessToken, refreshToken?, expiresAt }
  delete: (sid) => db.tokens.delete(sid),
  deleteSub: (sub) => db.tokens.deleteWhere({ sub }),
};
const sso = ssoRoutes({ tokenStore, backchannel: { store } });

app.get("/api/something", sso.require, async (c) => {
  const token = await sso.getAccessToken(c);   // renewed for you when it has expired
  …
});
```

- **Never in the cookie.** The session cookie is signed, not encrypted, and the
  browser can read it. It carries only a random `sid`; the tokens live in your
  store under that key.
- **`getAccessToken(c)`** returns the stored token, and when it has expired (or
  is within 30 s of it) renews it with the refresh token, stores the new pair
  and returns the new token. Two requests that need renewal at the same moment
  share one renewal (with rotation, a second one would be refused).
- **It throws `SsoError`, never returns a stale or empty token** — no live
  session, a session from before you configured a store, no tokens, or a refused
  renewal. A refused renewal also deletes the dead pair. The message names the
  status and BID's error code, never a token.
- **The tokens die with the session:** «Log ud» deletes the pair, and «Log ud
  overalt» (the back channel) calls `deleteSub(sub)` — inside the same step, so
  a failure is reported to BID as not done.
- **Purge old rows yourself — the package cannot.** A session that simply
  expires (no «Log ud»), or a new login that replaces one without a logout,
  leaves its row in your store indefinitely; nothing ever calls `delete` for it.
  Delete rows not WRITTEN for 7 days (`sensitive`: 12 hours) with a periodic job
  or a TTL — e.g. keep an `updatedAt` beside the row and
  `DELETE FROM tokens WHERE updated_at < now - 7 days`, or a Redis `EX` renewed on
  every `set`. A live session with a refresh token is rewritten by the hourly
  check, so it is never purged while in use (0.24.0). It matters because with `offline_access` the row holds a
  **refresh token**, and a forgotten refresh token is a live credential until
  the user's BID sign-in ends.
- **Since 0.10.0 the failures are `SsoReauthError`** (a subclass of `SsoError`,
  so existing `catch` blocks still match) with a `reason`: `no_session`,
  `no_tokens`, `expired` or `refresh_failed`. Every one of them means "log in
  again".
- **`memoryTokenStore()`** is the reference implementation for tests and one
  dev process. It warns once: in production it loses every user's tokens on a
  restart and is not shared between machines.
- **Without `tokenStore`, nothing changes** — login behaves exactly as in 0.8.0.

## Your own profile — accountRoutes (since 0.10.0)

The account page in your app: the signed-in user reads and changes her **own**
name and picture without being sent to BID. Needs the token store above.

```ts
import { ssoRoutes, accountRoutes } from "@broberg/sso/hono";

const sso = ssoRoutes({ tokenStore });
app.route("/auth", sso.app);
app.route("/api/account", accountRoutes(sso));   // pass what ssoRoutes returned
```

| route | does |
|---|---|
| `GET /api/account/profile` | `{sub, name, picture, email, account_url}` |
| `POST /api/account/profile` `{"name":"…"}` | changes the name, answers the new profile |
| `POST /api/account/profile/avatar` | raw image bytes as the body, `Content-Type: image/png`, `image/jpeg` or `image/webp`, max 2 MB |
| `POST /api/account/profile/avatar/remove` | removes the picture |

**Scopes.** Reading needs `profile` (in the default `SSO_SCOPES`). Changing needs
`profile:write` — it must be in your app's registration at BID **and** in
`SSO_SCOPES`, e.g. `SSO_SCOPES="openid profile email profile:write"`. A user who
logged in before you added it gets `403 insufficient_scope` until she logs in again.

**Every answer is JSON — it is an API, so never a login redirect:**

| status | body | means — what the page should do |
|---|---|---|
| 403 | `{"error":"cross_site"}` | a write from another site (`Sec-Fetch-Site`), sibling subdomains included — call it from the app's own page |
| 401 | `{"error":"unauthenticated"}` | no live session — send her to log in |
| 401 | `{"error":"reauth"}` | the session's BID tokens are spent — «Log ind igen» |
| 403 | `{"error":"insufficient_scope","scope":"profile:write"}` | «Log ind igen for at rette» |
| 413 | `{"error":"too_large","max_bytes":2097152}` | picture over 2 MB (refused before a byte goes to BID) |
| 415 | `{"error":"unsupported_type","accepted":[…]}` | not PNG, JPEG or WebP |
| 4xx | `{"error":"<BID's code>"}` | BID refused the value (e.g. an invalid name) |
| 502 | `{"error":"bid_unavailable"}` | BID did not answer usably |

**Renewal needs `offline_access`, in two places.** BID's access token lives one
hour. Since 2026-10-06 (broberg-id F084.156) BID issues a **refresh token**, but
only when your app's BID registration has `offline_access` (ask broberg-id, per
app) **and** you request it at login:
`SSO_SCOPES="openid profile email profile:write offline_access"`. Then
`getAccessToken` renews by itself and the account page keeps working.
- **Without `offline_access`** there is no refresh token. An hour after login,
  every account-page call answers `401 {"error":"reauth"}`.
- **With it, renewal still ends with the user's BID sign-in.** Log ud, «Log ud
  overalt», a new password or expiry make BID answer the renewal with
  `400 invalid_grant`, and that also becomes `401 {"error":"reauth"}`.
- **Rotation:** every renewal issues a new refresh token, and presenting the old
  one again revokes the whole chain. `getAccessToken` renews one session at a
  time **per process**. On several machines, a race costs one «Log ind igen»,
  never a stale token.

So `reauth` is a normal state, not an edge case. Build the page for it: a calm
«Log ind igen» that goes to `/auth/login?returnTo=<the account page>` (no
`prompt=login`), not an error. The same answer comes back when BID refuses the
access token itself (a 401 from BID). It is never a 500.

**The core methods**, if you are not on Hono: `client.getProfile(token)`,
`updateProfile(token, name)`, `uploadAvatar(token, bytes, contentType)`,
`removeAvatar(token)` — each returns the profile. They throw named errors:
`SsoInsufficientScopeError` (`.scope`), `SsoAvatarRejectedError` (`.reason`:
`too_large` | `unsupported_type`, thrown **before** anything is sent) and
`SsoAppApiError` (`.status`, BID's `.code`; `status` is null when BID did not
answer). All extend `SsoError`. No message ever contains a token.

**The user menu follows (since 0.11.0, F095.5).** Every successful
`accountRoutes` answer re-signs the session cookie with the name and picture BID
returned (`ssoRoutes().refreshSessionProfile`). sub, sid, iat and exp are kept,
and Max-Age is what is left of the session: the lifetime is never extended.
Nothing is written when nothing changed, and nothing is written on a refusal.
A reload therefore shows the new name in the menu without a new login. A GET also
picks up a change the user made in BID itself.

Mail, password, passkeys, two-factor and sessions stay in BID: link to the
profile's `account_url` in a new tab.

## What a refused login tells the browser (changed in 0.12.0)

**Changed default: the browser now gets ONE answer, `login_failed`, for an expired
login AND an unreadable cookie.** Through 0.11.0 it got `login_expired` and
`bad_login_cookie` separately. `no_login_in_progress` is unchanged.

| cause | your app / log (`onCallbackRefused`) | browser, default `"single"` | browser, `"granular"` |
|---|---|---|---|
| no login started here | `absent` | `no_login_in_progress` | `no_login_in_progress` |
| took too long | `expired` | `login_failed` | `login_expired` |
| signature did not hold | `unreadable` | `login_failed` | `bad_login_cookie` |

**Why.** The order in `parseTransaction` is what makes this matter, and it is not
obvious until you read the function: the signature is checked FIRST, and the age
only after it held. So `login_expired` is a positive confirmation that the
cookie's HMAC held against the CURRENT secret, and `bad_login_cookie` denies it.
Someone holding a cookie they FOUND (a log, a shared machine, a backup) could ask
whether it is still live, see the moment the secret rotates, and see whether two
environments share a secret. It does not help anyone forge anything. It is a
fact the server gave away for free. Reported by helpdesk, 22 September 2026.

**The operator still gets all three.** `onCallbackRefused(cause, c)` receives the
precise cause on every refusal; without it the adapter writes
`[@broberg/sso] /callback refused: <cause>` with `console.warn`. Watch for
`unreadable` on real users: that is what a rotated `SSO_COOKIE_SECRET` looks like. A hook that throws is reported with `console.error` and the refusal still stands (0.12.1); it never becomes a 500.

```ts
ssoRoutes({
  onCallbackRefused: (cause) => log.warn({ cause }, "sso callback refused"),
  // callbackErrors: "granular", // opt in: «dit login udløb» in the browser
});
```

**What the opt-in costs.** `callbackErrors: "granular"` gives the browser the
three codes back, so it can say *"your login expired, try again"*. The price is
the one bit above, for anyone with a found cookie. Fine for an internal app behind
a VPN; think twice on the open internet.


## Trusting another service — BID tickets (since 0.13.0)

One service proves who it is to another with a short-lived **ticket** from BrobergID (a JWT signed with BID's keys). The receiver checks it locally against BID's *public* keys — no shared secret anywhere. Format: broberg-id `docs/features/F087.1-identitetsmodel.md` §3 (draft until the organisation question is settled; only `org`'s mapping would move).

```ts
import { createTicketVerifier, JwksUnavailableError, SsoError } from "@broberg/sso";

const tickets = createTicketVerifier({
  issuer: "https://id.broberg.ai",
  audience: "https://discovery.broberg.ai", // THIS service's own URL
  warmUp: true,
});

try {
  const who = await tickets.verify(bearer, { scope: "discovery:read-fleet" });
  // { principal: "svc-trail", type: "service", clientId, org, act, version, cnf, scopes, exp, jti }
} catch (e) {
  if (e instanceof JwksUnavailableError) return c.text("try again", 503); // could not ask BID
  if (e instanceof SsoError) return c.text("forbidden", 401);            // the ticket is not acceptable
  throw e;
}
```

- **Checked:** signature against BID's key set (same algorithm allowlist as ID tokens, EdDSA first), `iss`, `aud` = your audience, `exp`/`iat` with 30 s skew, a `jti`, a known `principal_type` (human | service | agent | user), every scope you ask for, and a lifetime no longer than 15 minutes (BID issues 5 min for services, 15 for agents).
- **Never accepted as a ticket:** an ID token or a logout token, even though BID signed both.
- **BID briefly down:** a key already in the cache still verifies, with no network call. An unknown key while BID is down throws `JwksUnavailableError` — answer 503, do not reject the caller.
- Not a login client: a service that only receives tickets needs no `client_id`, no redirect and no session.

**Since 0.15.0 (F084.156, broberg-id-F087.15) — read for the future, never shortened:**

- `act` is the **whole delegation chain** (RFC 8693): agent-b acting for agent-a acting for user-1 is `{ sub: "agent-a", act: { sub: "user-1" } }`. `act.sub` is the same as before. A chain deeper than 5 links, or a link without a string `sub`, is **rejected** — 0.14.x kept only the first link and read a malformed `act` as "no delegation", both in the direction where the caller looks like it acts for fewer people.
- `version` is the ticket format (`ver`): 0 for a ticket from before BID set one, 1 today. A `ver` newer than this package understands is **rejected by name** ("upgrade @broberg/sso"), never read with today's rules.
- `cnf` is `{ jkt }` for a DPoP-bound ticket, else `null`. Since 0.16.0 it is checked — see below.

**Since 0.18.0 (F084.159, broberg-id-F087.37) — user tickets.** An app where a user is logged in with BID (a browser extension, say) swaps the user's access token for a ticket to ONE receiver. The receiver checks it with the same verifier:

```ts
const who = await tickets.verify(bearer, { scope: "trail:clip" });
// { type: "user", principal: "<the user's id>", clientId: "trail-clipper", … }
if (who.type !== "user" || who.clientId !== "trail-clipper") return c.text("forbidden", 403);
```

- `principal` is the **user**; `clientId` is the **app that swapped** (`client_id`, else `azp`). A user ticket that names neither is **rejected** — `clientId` is never read from `sub` on a user ticket, because that would let a user id stand in for an app id.
- BID decides only that the login may be used HERE. What the user may do is the receiver's call.

## DPoP — a bound ticket works only for whoever holds the key (0.16.0, F084.157)

A DPoP-bound ticket carries `cnf.jkt`, the thumbprint of the caller's public key. With each request the caller sends a short **proof** signed with the private key (method, URL, time, a hash of the ticket). A ticket copied out of a log does nothing on another machine. RFC 9449; joint design with broberg-id (broberg-id-F087.16).

**Receiver** — pass the request's `DPoP` header, method and **public** URL:

```ts
const auth = c.req.header("authorization") ?? "";
const token = auth.replace(/^(Bearer|DPoP) /, "");
const who = await tickets.verify(token, {
  scope: "discovery:read",
  dpop: { proof: c.req.header("dpop"), method: c.req.method, url: `https://discovery.broberg.ai${new URL(c.req.url).pathname}` },
});
```

- **A ticket WITH `cnf.jkt` needs a valid proof — always.** Without one it is refused, also while DPoP is optional for you. (Accepting bound tickets as bearer during a rollout would let a stolen one work the whole time.)
- **`requireDpop: true`** on `createTicketVerifier` also refuses UNBOUND tickets (and a `cnf` without a string `jkt`). Leave it off until every caller sends DPoP.
- **Checked:** `typ: dpop+jwt`, an asymmetric `alg`, the signature with the header's `jwk` (never a private key), `jwk` thumbprint = `cnf.jkt`, `htm` = the method, `htu` = the URL (without query/fragment), `iat` within ±60 s (`dpopIatWindowSec`), `ath` = this ticket, and a `jti` not seen before.
- **The URL must be the PUBLIC one.** Behind Fly's proxy your process sees `http://<internal>`; build the URL from your public origin, or every proof fails on `htu`.
- **Replay store:** in-memory by default, which holds on **one machine**. A receiver on two machines must pass one shared `replayStore` (`{ seen(key, ttlMs) }`), or a proof replayed against the other machine inside the window passes.
- Not yet: server nonces (RFC 9449 §8).

**Caller** — `createTicketClient({ dpop: true })`, then one `authHeaders` per request:

```ts
const tickets = createTicketClient({ dpop: true });
const headers = await tickets.authHeaders({ audience: "discovery", scope: "discovery:read", method: "GET", url: "https://discovery.broberg.ai/api/fleet" });
await fetch("https://discovery.broberg.ai/api/fleet", { headers }); // { authorization: "DPoP <ticket>", dpop: "<proof>" }
```

One ES256 key per client, non-extractable, never stored; BID binds the ticket to it from the proof on the token request. A proof is for one request — call `authHeaders` each time. Without `dpop`, `authHeaders` returns `{ authorization: "Bearer <ticket>" }` and nothing else changes.

## Getting a ticket — `fetchTicket` (since 0.14.1 — 0.14.0 was tagged but never reached npm)

The sending half: a workload on **Fly** or in **GitHub Actions** gets a BrobergID ticket with no key at all. It proves who it is with the identity its platform already gives it, and BID exchanges that (RFC 8693). Nothing secret is stored anywhere.

```ts
import { fetchTicket, NoWorkloadIdentityError, TicketExchangeError, TicketUnavailableError } from "@broberg/sso";

const ticket = await fetchTicket({ audience: "discovery", scope: "discovery:read" });
await fetch("https://discovery.broberg.ai/api/fleet", { headers: { authorization: `Bearer ${ticket}` } });
```

- **Fly:** asks the machine API (`unix:/.fly/api`, `POST /v1/tokens/oidc`, `aud` = the issuer). The ticket's subject is `svc:<fly app name>` — BID derives it from the app name, so the rule in BID must name the app exactly.
- **GitHub Actions:** uses `ACTIONS_ID_TOKEN_REQUEST_URL` / `_TOKEN`; the workflow needs `permissions: id-token: write`. Subject `svc:gh:<owner>/<repo>`, and BID's rule names ONE workflow file (a new file cannot get a ticket).
- **Anywhere else** (a Mac session, a laptop): `NoWorkloadIdentityError` — keep using the session key there.
- **Cached** per audience + scope until 30 s before exp (BID issues 5 min), and concurrent calls share one exchange. `createTicketClient({...})` gives you your own cache and injectable platform/fetch for tests.
- **Errors:** `TicketExchangeError` (BID refused — `code` is BID's name for it, `status` the HTTP status; permanent, fix the rule) · `TicketUnavailableError` (BID or the platform unreachable / 5xx; transient) · `NoWorkloadIdentityError`. BID's codes include `no_rule_for_audience`, `scope_not_allowed`, `service_not_registered`, `audience_unknown`, `workflow_not_allowed`, `fly_org_untrusted`, `fly_audience_mismatch`, `github_owner_untrusted`, `client_mismatch`, `issuer_unknown`.
- The ticket is never logged or put in an error message.

### On Fly, if your container does not run as root: `EACCES /.fly/api`

`/.fly/api` is created by Fly **at machine start**, owned `root:root` with mode
`srwxr-xr-x`. A container that runs as a non-root user (`USER bun`, `USER node`)
cannot connect, and `fetchTicket` fails with
`TicketUnavailableError: Fly OIDC socket: connect EACCES /.fly/api`.

**The proven pattern** — from buzzalert-core (in production), reused by cardmem
and measured on a real Fly machine (28 Oct 2026): start as root, give the
socket to your app's GROUP, then drop privileges for the app itself.

```sh
#!/bin/sh
# fly-entrypoint.sh — runs as root, only long enough to hand over the socket
set -e
if [ -S /.fly/api ]; then
  chgrp bun /.fly/api && chmod g+w /.fly/api
fi
exec setpriv --reuid=bun --regid=bun --init-groups bun run server.ts
```

```dockerfile
# remove `USER bun` — the entrypoint drops to bun itself
COPY fly-entrypoint.sh /fly-entrypoint.sh
ENTRYPOINT ["/fly-entrypoint.sh"]
```

- **It must happen at runtime**, in the entrypoint: the socket does not exist at build time.
- **Group-write, not `chmod 666`.** 666 hands the machine's OIDC identity to *every* process in the container; `g+w` gives it to your app's group only.
- **Do not run the whole app as root** to make the error go away.
- `setpriv` is in util-linux, present in the Debian-based `-slim` images (`oven/bun:1-slim`, `node:24-slim`). Swap `bun` for your image's user.

## A ticket on behalf of a USER — `exchangeUserToken` (0.20.0, F084.179, BID F087.37)

A signed-in user's BID access token, exchanged for a ticket to ONE receiver. Same ticket format as the
machines' (`ver` 1), with `principal_type: "user"`, `sub` = the user and `client_id` = your app — so the
receiver checks it with `createTicketVerifier`, the same as a machine ticket.

```ts
import { exchangeUserToken } from "@broberg/sso";

const { token, exp } = await exchangeUserToken({
  clientId: "jam",
  clientSecret: process.env.SSO_CLIENT_SECRET,   // omit for a public app (a browser extension): client_id goes in the body
  subjectToken: userAccessToken,                 // the user's BID access token — never logged, never in an error
  resource: "https://cardmem.com",               // or audience: "<BID's name for the receiver>" — one is required
  scope: "cardmem:mockups:read",
  // dpopKey: await createDpopKey(),             // optional: bind the ticket to a key
});
```

- **Not cached** — it is per user. When it expires, exchange again with the user's (renewed) access token.
- **Errors** are the same classes as `fetchTicket`. BID's codes for this path include `subject_token_inactive`
  (the user's BID login has ended — «log ud» means log out), `client_mismatch` (the token belongs to another app),
  `subject_is_ticket`, `session_ended`, `no_rule_for_audience`, `scope_not_allowed`, `client_unauthenticated`.
- BID issues nothing without a rule for (your app, the receiver). Ask broberg-id for the rule.

## A2A: checking another agent's card and ticket — `verifyAgentCard` / `createA2AVerifier` (0.25.0, F084.182)

BID publishes every ACTIVE agent's A2A v1.0.0 card at `<issuer>/agents/<agent-id>/agent-card.json`,
signed per §8.4 (detached JWS, EdDSA, over the RFC 8785 canonical form of the card without its
`signatures`).

```ts
import { verifyAgentCard, createA2AVerifier } from "@broberg/sso";

const r = await verifyAgentCard(card, { issuer: "https://id.broberg.ai" });
if (!r.ok) return r.reason === "jwks_unreachable" ? res503() : res401(r.reason);
r.kid; r.card; // the card without its signatures

const a2a = createA2AVerifier({ issuer: "https://id.broberg.ai", audience: "https://my.agent" });
const p = await a2a.verify(ticket);      // everything createTicketVerifier checks, plus:
p.agentCard;                             // agent tickets: the issuer's card URL for THAT agent; else null
```

- **`jku` in a card is never followed.** The key set is derived from the issuer you configured;
  a card naming another `jku` is refused as `untrusted_jku` and that URL is not fetched — a forged
  card would otherwise name its own judge.
- **Named outcomes:** `malformed` · `untrusted_jku` · `unknown_kid` · `bad_signature` ·
  `jwks_unreachable`. Only the last means "could not check right now" (503, retry); the rest mean
  "not acceptable".
- **An agent ticket's `agent_card` must be `<issuer>/agents/<sub>/agent-card.json`** — anything
  else is refused, so a receiver that goes on to fetch the card cannot be pointed at another host.
- `canonicalize()` (JCS) is exported and passes RFC 8785's own test vectors. No new dependency.

## Login without a client secret — `clientAuth: "fly"` (0.21.0, F084.181, BID F084.180)

An app on Fly can prove itself at BID's token endpoint with its Fly identity instead of a
`client_secret`. Nothing to store, nothing to rotate, nothing to leak.

```ts
const sso = ssoRoutes({ clientAuth: "fly", tokenStore });   // or SSO_CLIENT_AUTH=fly
```

- At the code exchange (and at refresh) the app asks Fly's machine API for an OIDC token with
  `aud` = BID's **token endpoint** (not the issuer, so a ticket token cannot be replayed as a login
  proof) and sends it as `client_assertion` with
  `client_assertion_type=urn:broberg:params:oauth:client-assertion-type:fly-oidc`. PKCE is unchanged.
- **No fallback.** With `"fly"`, `client_secret` is never sent to the token endpoint, even if one is
  configured. If Fly cannot give a token, the login fails: the browser gets one generic 500, the log
  gets `fly client assertion unavailable: …`.
- **BID must be switched first**: the client registered as `token_endpoint_auth_method: fly_oidc`,
  bound to your Fly org and app. Ask broberg-id. Switch the app, measure one login, then BID deletes
  the secret.
- `clientSecret` is still what introspection and the embedded login use — those are not the token
  endpoint's code exchange.
- Without the option nothing changes: the 0.20.0 request, byte for byte.
