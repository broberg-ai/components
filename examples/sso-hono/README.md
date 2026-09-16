# sso-hono-example

The whole integration, as proof for F084.4 AC#5: **no identity code beyond
mounting the package.** Every decision — which issuer, which client, how long a
session lasts — is an environment variable.

```bash
cp .env.example .env    # then set a real SSO_COOKIE_SECRET
bun run dev
```

`server.ts` is ~40 lines and none of them touch a password, a passkey, a
provider key or a client secret. It cannot: the package does not expose them.
