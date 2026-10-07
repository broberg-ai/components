// F098.1 — WebMCP lab: a FICTIONAL bookable business, used to measure which AI
// agents and chat services can find, read and act on a booking page today.
//
// Three routes to the same booking, so each can be measured on its own:
//   1. plain HTML + a booking URL with the details in the address (works with no JS)
//   2. Schema.org JSON-LD with a ReserveAction whose urlTemplate is that URL
//   3. WebMCP: document.modelContext.registerTool (Chrome 150+; navigator.* before)
// Nothing is ever booked: the confirmation step says so. Every request and every
// tool call is kept in a small in-memory log (GET /webmcp-lab/hits), so "did the
// chat actually fetch it, and which agent called the tool" is answered by the
// server, not by what a chat claims it did. The log holds a user-agent CLASS and a
// timestamp — no IP, no full user-agent string.
import { Hono } from "hono";

export const LAB_SERVICES = [
  { id: "konsultation", name: "Første konsultation", minutes: 60, priceDkk: 650 },
  { id: "opfoelgning", name: "Opfølgende behandling", minutes: 45, priceDkk: 500 },
  { id: "kort", name: "Kort behandling", minutes: 30, priceDkk: 350 },
] as const;

const BASE = "https://discovery.broberg.ai/webmcp-lab";
const NAME = "WebMCP-lab Testklinik";
const MAX_HITS = 500;

export type HitKind = "page" | "book" | "tool";
export interface Hit {
  at: string;
  kind: HitKind;
  agent: string;
  detail?: string;
}

/** Which kind of client this is — a class, never the raw string. */
export function agentClass(ua: string | undefined): string {
  const u = (ua ?? "").toLowerCase();
  if (u.includes("chatgpt-user")) return "chatgpt-user";
  if (u.includes("oai-searchbot")) return "oai-searchbot";
  if (u.includes("gptbot")) return "gptbot";
  if (u.includes("claude-user")) return "claude-user";
  if (u.includes("claude-searchbot")) return "claude-searchbot";
  if (u.includes("claudebot")) return "claudebot";
  if (u.includes("perplexity")) return "perplexity";
  if (u.includes("google-extended") || u.includes("googlebot")) return "google";
  if (u.includes("headlesschrome")) return "headless-chrome";
  if (u.includes("chrome")) return "chrome";
  if (u.includes("safari")) return "safari";
  if (u === "") return "none";
  return "other";
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function labJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: NAME,
    description: "Fiktiv klinik til test af AI-booking (WebMCP-lab). Intet bookes rigtigt.",
    url: BASE,
    makesOffer: LAB_SERVICES.map((s) => ({
      "@type": "Offer",
      identifier: s.id,
      price: s.priceDkk,
      priceCurrency: "DKK",
      itemOffered: { "@type": "Service", name: s.name, identifier: s.id },
    })),
    potentialAction: {
      "@type": "ReserveAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${BASE}/book?service={service}&date={date}&time={time}`,
        actionPlatform: ["https://schema.org/DesktopWebPlatform", "https://schema.org/MobileWebPlatform"],
      },
      result: { "@type": "Reservation", name: "Booking hos WebMCP-lab Testklinik" },
    },
  };
}

const PAGE_STYLE = `body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#1a1a1a}
code{background:#f2f2f2;padding:1px 4px;border-radius:4px;word-break:break-all}
.note{background:#fff6d6;border:1px solid #e8d48a;padding:10px 12px;border-radius:8px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left}
button{font:inherit;padding:10px 16px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#fff;cursor:pointer}
button:hover{background:#333}button:active{transform:translateY(1px)}`;

// The WebMCP half. Feature-detected, so a browser without it runs nothing and
// shows no error. document.modelContext is the spec's home (draft 2 Oct 2026);
// Chrome 149 only had navigator.modelContext, so both are tried.
const WEBMCP_SCRIPT = `(() => {
  const mc = document.modelContext || navigator.modelContext;
  const report = (detail) => { try { navigator.sendBeacon(${JSON.stringify(BASE)} + "/hits", JSON.stringify({ detail })); } catch (e) {} };
  document.documentElement.dataset.webmcp = mc && mc.registerTool ? "registered" : "absent";
  if (!mc || !mc.registerTool) return;
  const services = ${JSON.stringify(LAB_SERVICES)};
  mc.registerTool({
    name: "list_services",
    title: "Se behandlinger",
    description: "Lists the clinic's bookable services with id, duration in minutes and price in DKK.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => { report("list_services"); return { content: [{ type: "text", text: JSON.stringify(services) }] }; },
  });
  mc.registerTool({
    name: "start_booking",
    title: "Start booking",
    description: "Opens the booking confirmation page prefilled with service, date and time. Nothing is booked until the person confirms on that page.",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", enum: services.map((s) => s.id) },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM, 24-hour" },
      },
      required: ["service", "date", "time"],
    },
    annotations: { readOnlyHint: false, consequentialHint: true },
    execute: async (input) => {
      report("start_booking");
      const u = new URL(${JSON.stringify(BASE)} + "/book");
      for (const k of ["service", "date", "time"]) u.searchParams.set(k, String(input[k] ?? ""));
      location.assign(u.toString());
      return { content: [{ type: "text", text: "Opened the confirmation page: " + u.toString() + ". The person must press Bekræft there." }] };
    },
  });
})();`;

function labPage(): string {
  const rows = LAB_SERVICES.map(
    (s) => `<tr><td><code>${s.id}</code></td><td>${esc(s.name)}</td><td>${s.minutes} min</td><td>${s.priceDkk} kr.</td></tr>`,
  ).join("");
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${NAME} — book en tid</title>
<script type="application/ld+json">${JSON.stringify(labJsonLd())}</script>
<style>${PAGE_STYLE}</style></head><body>
<h1>${NAME}</h1>
<p class="note" data-testid="lab-fiction-note">Dette er en <strong>fiktiv</strong> klinik til at teste booking fra AI-assistenter. Intet bookes rigtigt.</p>
<h2>Behandlinger</h2>
<table data-testid="lab-services"><thead><tr><th>id</th><th>Behandling</th><th>Varighed</th><th>Pris</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Åbningstider</h2><p>Mandag–fredag 9:00–17:00. Tider hvert hele og halve klokkeslæt.</p>
<h2>Sådan booker du</h2>
<p>Åbn bookingsiden med behandling, dato og tid i adressen. Du ser en bekræftelse, før noget sker:</p>
<p><code>${BASE}/book?service=konsultation&amp;date=2026-10-20&amp;time=10:00</code></p>
<p><a href="${BASE}/book?service=konsultation&amp;date=2026-10-20&amp;time=10:00" data-testid="lab-example-booking-link">Eksempel: første konsultation 20. oktober kl. 10:00</a></p>
<script>${WEBMCP_SCRIPT}</script>
</body></html>`;
}

function bookPage(q: { service?: string; date?: string; time?: string }): { status: 200 | 400; html: string } {
  const svc = LAB_SERVICES.find((s) => s.id === q.service);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(q.date ?? "");
  const timeOk = /^\d{2}:\d{2}$/.test(q.time ?? "");
  const head = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Bekræft booking — ${NAME}</title><style>${PAGE_STYLE}</style></head><body>`;
  if (!svc || !dateOk || !timeOk) {
    return {
      status: 400,
      html: `${head}<h1>Bookingen mangler oplysninger</h1><p data-testid="lab-book-error">Angiv service (${LAB_SERVICES.map((s) => s.id).join(", ")}), date (ÅÅÅÅ-MM-DD) og time (TT:MM).</p><p><a href="${BASE}" data-testid="lab-back-link">Tilbage</a></p></body></html>`,
    };
  }
  return {
    status: 200,
    html: `${head}<h1>Bekræft din booking</h1>
<p class="note">Fiktiv klinik — intet bookes rigtigt.</p>
<dl data-testid="lab-book-summary"><dt>Behandling</dt><dd data-testid="lab-book-service">${esc(svc.name)}</dd><dt>Dato</dt><dd data-testid="lab-book-date">${esc(q.date!)}</dd><dt>Tid</dt><dd data-testid="lab-book-time">${esc(q.time!)}</dd><dt>Pris</dt><dd>${svc.priceDkk} kr.</dd></dl>
<button type="button" data-testid="lab-book-confirm" onclick="this.disabled=true;document.getElementById('done').hidden=false">Bekræft</button>
<p id="done" hidden data-testid="lab-book-done">Tak. Dette var en test — intet er booket.</p>
</body></html>`,
  };
}

export function webmcpLab(now: () => Date = () => new Date()) {
  const hits: Hit[] = [];
  const record = (kind: HitKind, ua: string | undefined, detail?: string) => {
    hits.push({ at: now().toISOString(), kind, agent: agentClass(ua), ...(detail ? { detail } : {}) });
    if (hits.length > MAX_HITS) hits.splice(0, hits.length - MAX_HITS);
  };

  const app = new Hono();
  app.get("/", (c) => {
    record("page", c.req.header("user-agent"));
    return c.html(labPage());
  });
  app.get("/book", (c) => {
    const q = { service: c.req.query("service"), date: c.req.query("date"), time: c.req.query("time") };
    record("book", c.req.header("user-agent"), [q.service, q.date, q.time].join(" "));
    const r = bookPage(q);
    return c.html(r.html, r.status);
  });
  // The page's tool calls report here (sendBeacon). Only a known tool name is kept.
  app.post("/hits", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = body?.detail;
    if (detail !== "list_services" && detail !== "start_booking") return c.json({ error: "invalid_request" }, 400);
    record("tool", c.req.header("user-agent"), detail);
    return c.body(null, 204);
  });
  app.get("/hits", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ count: hits.length, hits: hits.slice(-200) });
  });
  return { app, hits };
}
