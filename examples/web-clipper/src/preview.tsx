// The popup served as a PAGE (server.ts, :5200), so Lens can see and drive it:
// Lens cannot load an extension. Same component and CSS as the real popup;
// auth, page and destination are in-memory fakes. Invented data.
// ?state=down makes every send fail with 503, ?state=consent asks for consent.
// ?state=embedded (F099.24) logs in INSIDE the popup with the real engine against an in-page fake
// BID that follows contract v1: mail code 481072; ?state=embedded-2fa adds a second factor
// (app 123456, SMS 777777). Five wrong codes lock the flow.
// ?state=embedded-passkey (F099.26) opens on the passkey: the in-page BID lives on this page's own
// origin and server.ts serves a stand-in frame that posts the answer. The other embedded states
// are a client WITHOUT a passkey (404), so they keep the classic mail screen.
import "@broberg/theme/css/palettes.css";
import "@broberg/web-clipper/css/clipper.css";
import { render } from "preact";
import { initPalette, initTheme } from "@broberg/theme";
import { ClipperPopup } from "@broberg/web-clipper/ui";
import { DestinationError } from "@broberg/web-clipper/transport";
import { createBidAuth } from "@broberg/web-clipper/auth";
import { demoDestination } from "./demo";

initTheme();
initPalette();

const mode = new URLSearchParams(location.search).get("state");
const data = new Map<string, unknown>();
const storage = { get: async (k: string) => data.get(k), set: async (k: string, v: unknown) => void data.set(k, v), remove: async (k: string) => void data.delete(k) };
let session: { accessToken: string; sub: string; expiresAt: number } | null = null;
const fakeAuth = {
  async login() { await new Promise((r) => setTimeout(r, 400)); session = { accessToken: "demo", sub: "demo-user", expiresAt: Date.now() + 3600_000 }; return session; },
  async session() { return session; },
  async logout() { session = null; },
};

/** An in-page BID per F084.166 contract v1 — invented, for the preview only. */
function fakeBidFetch(secondFactor: boolean, passkey = false): typeof fetch {
  const flows = new Map<string, { wrong: number; sms: boolean }>();
  let n = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const id = (payload: object) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.y`;
  return (async (input: unknown, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, 350));
    const url = new URL(String(input));
    if (url.pathname === "/.well-known/openid-configuration") return json(200, { authorization_endpoint: `${url.origin}/oauth2/authorize`, token_endpoint: `${url.origin}/oauth2/token` });
    if (url.pathname === "/oauth2/token") return json(200, { access_token: "demo", refresh_token: "demo-r", expires_in: 3600, id_token: id({ sub: "demo-user" }) });
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (passkey && url.pathname === "/embedded/passkey/start") { const f = `pk-${++n}`; return json(200, { flow_id: f, frame_url: `${url.origin}/embedded/passkey/frame?flow=${f}`, expires_in: 600 }); }
    if (passkey && url.pathname === "/embedded/passkey/complete") return json(200, { next: "done", code: "demo-code" });
    if (url.pathname.startsWith("/embedded/passkey/")) return json(404, {}); // a client without a passkey, as BID answers it
    if (url.pathname === "/embedded/start") { const f = `flow-${++n}`; flows.set(f, { wrong: 0, sms: false }); return json(200, { flow_id: f, expires_in: 600 }); }
    const f = flows.get(body.flow_id);
    if (!f) return json(400, { error: "expired" });
    const wrong = () => (++f.wrong >= 5 ? json(429, { error: "locked", retry_after: 600 }) : json(400, { error: "invalid_code", attempts_left: 5 - f.wrong }));
    if (url.pathname === "/embedded/verify") return body.code !== "481072" ? wrong() : secondFactor ? json(200, { next: "second_factor", methods: ["totp", "sms"] }) : json(200, { next: "done", code: "demo-code" });
    if (url.pathname === "/embedded/second-factor/sms") { f.sms = true; return json(200, { sent: true }); }
    if (url.pathname === "/embedded/second-factor") return (body.method === "totp" && body.code === "123456") || (body.method === "sms" && f.sms && body.code === "777777") ? json(200, { next: "done", code: "demo-code" }) : wrong();
    return json(404, {});
  }) as typeof fetch;
}
const embedded = mode === "embedded" || mode === "embedded-2fa" || mode === "embedded-passkey";
const auth = embedded
  ? createBidAuth({
      issuer: mode === "embedded-passkey" ? location.origin : "https://id.example.invalid", clientId: "example-clipper", storage, fetchImpl: fakeBidFetch(mode === "embedded-2fa", mode === "embedded-passkey"),
      identity: { getRedirectURL: () => "https://example.invalid/", launchWebAuthFlow: async () => undefined },
    })
  : fakeAuth;
const base = demoDestination(storage);
const destination = {
  ...base,
  requiresConsent: mode === "consent",
  async send(...a: Parameters<typeof base.send>) {
    await new Promise((r) => setTimeout(r, 300));
    if (mode === "down") throw new DestinationError(503);
    return base.send(...a);
  },
};
const clip = mode === "consent"
  ? { url: "https://chatgpt.com/c/demo", title: "Samtale", anchor: "demo", units: [{ kind: "turn", role: "user", content: "Hej", position: 0 }] }
  : { url: "https://example.com/artikel", title: "En artikel", units: [{ kind: "page", content: "# En artikel", position: 0 }] };

render(
  <div style="padding:24px;display:flex;justify-content:center">
    <div style="border:1px solid var(--border);border-radius:var(--radius,8px);overflow:visible">
      <ClipperPopup title="Web Clipper Example" auth={auth} destination={destination} getClip={async () => clip} storage={storage} fields={[{ id: "tags", label: "Emneord", placeholder: "kommasepareret" }]} embeddedLogin={embedded} />
    </div>
  </div>,
  document.getElementById("app")!,
);
