# @broberg/sso

The thin client for **Broberg ID** (`id.broberg.ai`). Send a user to central
login, verify the ID token against JWKS, keep a local session. That is all it
does, and the list of what it deliberately cannot do is part of the design.

```bash
pnpm add @broberg/sso
```

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

### 2. The login flow cookie's lifetime (0.2.5)

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

**Mount the Hono adapter and you get all of this for free** — the signed window,
the longer cookie, and three distinct answers (`login_expired` ·
`no_login_in_progress` · `bad_login_cookie`). Take the core and nothing is passed
on your behalf. Reported by broberg-id, who found their own framework-free
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
