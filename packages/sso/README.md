# @broberg/sso

The thin client for **Broberg ID** (`id.broberg.ai`). Send a user to central
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
SSO_SESSION_MAX_AGE=604800              # 7 days (fleet default, F084.7)
SSO_POST_LOGOUT_REDIRECT_URI=https://my.app/
```

**Handling personal or health data? Set `SSO_SESSION_MAX_AGE=43200`.** The
default is twelve hours' worth of convenience too long for that case — F084.7
decided 12 hours plus a 30-minute inactivity cut for anything holding personal
or health data. The default is a normal-app default, not a safe-for-everything
one.

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

The adapter above mints **its own** session cookie, keyed on Broberg ID's `sub`.
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

**Or decide not to log out of Broberg ID at all — that is the other valid
shape, not a lesser one.** HelpDesk clears only its own session cookie and never
redirects to the issuer's end-session endpoint. Then there is no foreign
confirmation page to get past and no `idTokenHint` to be missing, and you need
none of the code above. The consequence is real and worth choosing on purpose
rather than discovering: **signing out of your app leaves the Broberg ID session
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

The session cookie is `SameSite=Lax`, not `Strict`. The callback from Broberg ID
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

Two calls that authenticate with **your app's own key** (`bidk_…`, issued by Broberg ID) — not the client secret, not a user's token.

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

When a user presses **«Log ud overalt»** in Broberg ID, BID tells every app it has registered for that: an OIDC Back-Channel Logout token to `POST <mount>/backchannel-logout`. The ordinary «Log ud» in BID does **not** reach your app (owner decision D-376ffa), and the package refuses a token carrying `sid` to keep it that way.

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
  Delete rows older than `sessionMaxAge` (`SSO_SESSION_MAX_AGE`, default 7 days)
  with a periodic job or a TTL — e.g. store a `createdAt` beside the row and
  `DELETE FROM tokens WHERE created_at < now - sessionMaxAge`, or a Redis
  `EX sessionMaxAge`. It matters because with `offline_access` the row holds a
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

One service proves who it is to another with a short-lived **ticket** from Broberg ID (a JWT signed with BID's keys). The receiver checks it locally against BID's *public* keys — no shared secret anywhere. Format: broberg-id `docs/features/F087.1-identitetsmodel.md` §3 (draft until the organisation question is settled; only `org`'s mapping would move).

```ts
import { createTicketVerifier, JwksUnavailableError, SsoError } from "@broberg/sso";

const tickets = createTicketVerifier({
  issuer: "https://id.broberg.ai",
  audience: "https://discovery.broberg.ai", // THIS service's own URL
  warmUp: true,
});

try {
  const who = await tickets.verify(bearer, { scope: "discovery:read-fleet" });
  // { principal: "svc-trail", type: "service", clientId, org, act, scopes, exp, jti }
} catch (e) {
  if (e instanceof JwksUnavailableError) return c.text("try again", 503); // could not ask BID
  if (e instanceof SsoError) return c.text("forbidden", 401);            // the ticket is not acceptable
  throw e;
}
```

- **Checked:** signature against BID's key set (same algorithm allowlist as ID tokens, EdDSA first), `iss`, `aud` = your audience, `exp`/`iat` with 30 s skew, a `jti`, a known `principal_type` (human | service | agent), every scope you ask for, and a lifetime no longer than 15 minutes (BID issues 5 min for services, 15 for agents).
- **Never accepted as a ticket:** an ID token or a logout token, even though BID signed both.
- **BID briefly down:** a key already in the cache still verifies, with no network call. An unknown key while BID is down throws `JwksUnavailableError` — answer 503, do not reject the caller.
- Not a login client: a service that only receives tickets needs no `client_id`, no redirect and no session.

## Getting a ticket — `fetchTicket` (since 0.14.1 — 0.14.0 was tagged but never reached npm)

The sending half: a workload on **Fly** or in **GitHub Actions** gets a Broberg ID ticket with no key at all. It proves who it is with the identity its platform already gives it, and BID exchanges that (RFC 8693). Nothing secret is stored anywhere.

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
