/**
 * A Bun + Hono app that signs in through the LIVE Broberg ID.
 *
 * This file is the evidence for F084.4 AC#5: every identity decision is an
 * environment variable, and the only identity CODE is the three mounting lines
 * below. Nothing here handles a password, a passkey, a provider key or a client
 * secret — the package does not expose them, so this app could not do it even
 * by mistake.
 *
 *   bun run server.ts
 */
import { Hono } from "hono";
import { ssoRoutes, getSession } from "@broberg/sso/hono";

const app = new Hono();

// ── the entire integration ───────────────────────────────────────────────────
const sso = ssoRoutes({ loginPath: "/auth" });
app.route("/auth", sso.app); // /auth/login · /auth/callback · /auth/logout
app.use("*", sso.attach); // read the session; never blocks
// ─────────────────────────────────────────────────────────────────────────────

const page = (body: string) => `<!doctype html>
<html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SSO-eksempel</title>
<style>
  :root{--bg:#23282f;--fg:#f0f4f8;--muted:rgba(240,244,248,.55);
        --primary:#00b2ff;--on-primary:#04222f;--card:rgba(255,255,255,.04);
        --border:rgba(255,255,255,.09)}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
    background:var(--bg);color:var(--fg);
    font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .card{width:100%;max-width:420px;background:var(--card);
    border:1px solid var(--border);border-radius:12px;padding:32px 28px;text-align:center}
  h1{font-size:21px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em}
  p{color:var(--muted);margin:0 0 20px;font-size:14px}
  .who{font-size:26px;font-weight:600;letter-spacing:-.02em;margin:6px 0 2px}
  .sub{font-size:13px;color:var(--muted);margin-bottom:22px}
  a.btn{display:inline-flex;align-items:center;justify-content:center;
    min-height:44px;padding:11px 24px;border-radius:100px;background:var(--primary);
    color:var(--on-primary);font-weight:600;text-decoration:none;transition:.14s}
  a.btn:hover{filter:brightness(1.08)}
  a.btn:active{transform:translateY(1px)}
  a.btn:focus-visible{outline:2px solid #ff6a45;outline-offset:2px}
  a.ghost{background:transparent;border:1px solid var(--border);color:var(--fg);font-weight:500}
  a.ghost:hover{background:rgba(255,255,255,.06)}
  code{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--muted)}
  .pic{width:88px;height:88px;border-radius:100px;object-fit:cover;display:block;margin:0 auto 12px;
       border:1px solid var(--border)}
</style></head><body><main class="card">${body}</main></body></html>`;

app.get("/", (c) => {
  const session = getSession(c);

  if (!session) {
    return c.html(
      page(`
        <h1>Ikke logget ind</h1>
        <p>Denne app har ingen egen brugerdatabase. Den spørger Broberg ID.</p>
        <a class="btn" href="/auth/login" data-testid="example-login">Log ind med Broberg ID</a>
      `),
    );
  }

  // WHERE EACH FIELD COMES FROM, because the distinction is real and the first
  // version of this page stated it wrongly on screen:
  //   sub   the ID token, signed by BID and verified against its JWKS
  //   name  BID's userinfo endpoint, bound to that same sub by the package
  // The ID token carries iss/sub/aud/iat/exp and NOT a name — measured on the
  // live service. This app never saw a password either way.
  return c.html(
    page(`
      <h1>Logget ind</h1>
      <p>Identiteten er et ID-token Broberg ID signerede. Navnet er hentet fra
         dens profil-endepunkt og bundet til samme bruger.</p>
      ${session.picture
        ? `<img class="pic" src="${escape(session.picture)}" alt="" data-testid="example-picture">`
        : ""}
      <div class="who" data-testid="example-name">${escape(session.name ?? "(uden navn)")}</div>
      <div class="sub" data-testid="example-email">${escape(session.email ?? "")}</div>
      <p><code data-testid="example-sub">sub: ${escape(session.sub)}</code></p>
      <a class="btn ghost" href="/auth/logout" data-testid="example-logout">Log ud</a>
    `),
  );
});

/** A protected page, to show `require` redirecting rather than 403-ing. */
app.get("/hemmelig", sso.require, (c) =>
  c.html(page(`<h1>Kun for indloggede</h1><p>${escape(getSession(c)!.sub)}</p>`)),
);

function escape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const port = Number(process.env.PORT ?? 8123);
console.log(`[eksempel] http://localhost:${port} — issuer ${sso.config.issuer}`);
export default { port, fetch: app.fetch };
