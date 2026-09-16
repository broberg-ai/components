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
