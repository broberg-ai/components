import { SITE_CSS, topBar, THEME_JS } from "../../scripts/site-chrome.mjs";
import { FAVICON } from "../../scripts/favicon.mjs";
// F038.29 — who logs in with BID tickets (F087 / WIF), read LIVE from BID.
//
// BID is the only source. Discovery fetches BID's registry endpoint with its
// own service ticket and caches a good answer for a few minutes. It never keeps
// a hand-written list: a copy is wrong from the day BID gets a new rule.
//
// Three states, and they must never be confused:
//   ok             — BID answered; `rules` is BID's list (it may be empty).
//   not_configured — the endpoint is not wired yet (ship dark).
//   error          — BID is down or refused; `lastGoodAt` says how old our
//                    last good answer is. NEVER an empty list dressed as success,
//                    because "no app uses tickets" and "we could not ask" are
//                    opposite facts.

export type RuleType = "service" | "github" | "user" | "login";

export interface RegistryRule {
  app: string;
  type: RuleType;
  audience: string;
  scopes: string[];
  since: string;
}

export type RegistryState =
  | { status: "ok"; source: string; generatedAt: string; fetchedAt: string; rules: RegistryRule[] }
  | { status: "not_configured"; message: string }
  | { status: "error"; source: string; error: string; lastGoodAt: string | null };

export interface TicketRegistryOptions {
  /** BID's registry endpoint. Unset → not_configured. */
  url?: string;
  /** Discovery's own ticket for BID (createTicketClient().get(...) in production). */
  getToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** How long a good answer is reused. Default 5 minutes. */
  ttlMs?: number;
}

export const NOT_CONFIGURED_MESSAGE = "BID-endepunktet er ikke klar endnu";

const TYPES = new Set<RuleType>(["service", "github", "user", "login"]);

function parse(body: unknown): { generatedAt: string; rules: RegistryRule[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { generatedAt?: unknown; rules?: unknown };
  if (typeof b.generatedAt !== "string" || !Array.isArray(b.rules)) return null;
  const rules: RegistryRule[] = [];
  for (const r of b.rules as Record<string, unknown>[]) {
    if (
      !r || typeof r.app !== "string" || typeof r.audience !== "string" || typeof r.since !== "string" ||
      !TYPES.has(r.type as RuleType) || !Array.isArray(r.scopes) || !r.scopes.every((s) => typeof s === "string")
    ) return null;
    rules.push({ app: r.app, type: r.type as RuleType, audience: r.audience, scopes: r.scopes as string[], since: r.since });
  }
  return { generatedAt: b.generatedAt, rules };
}

export function createTicketRegistry(opts: TicketRegistryOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
  let good: { state: Extract<RegistryState, { status: "ok" }>; at: number } | null = null;

  return {
    async get(): Promise<RegistryState> {
      if (!opts.url || !opts.getToken) return { status: "not_configured", message: NOT_CONFIGURED_MESSAGE };
      if (good && now() - good.at < ttlMs) return good.state;
      const fail = (error: string): RegistryState => ({
        status: "error",
        source: opts.url!,
        error,
        lastGoodAt: good ? new Date(good.at).toISOString() : null,
      });
      let res: Response;
      try {
        const token = await opts.getToken();
        res = await fetchImpl(opts.url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
      } catch (e) {
        return fail(`unreachable: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!res.ok) return fail(`BID answered ${res.status}`);
      let parsed: ReturnType<typeof parse>;
      try {
        parsed = parse(await res.json());
      } catch {
        parsed = null;
      }
      if (!parsed) return fail("BID's answer did not have the agreed shape");
      const at = now();
      const state = { status: "ok" as const, source: opts.url, generatedAt: parsed.generatedAt, fetchedAt: new Date(at).toISOString(), rules: parsed.rules };
      good = { state, at };
      return state;
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const TYPE_LABEL: Record<RuleType, string> = {
  service: "tjeneste (Fly OIDC)",
  github: "GitHub Actions",
  user: "bruger-billet",
  login: "login med platform-ID",
};

/** Human-readable time for the page — Danish time, named (house rule: a server renders in UTC). */
function daTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString("da-DK", { timeZone: "Europe/Copenhagen", dateStyle: "short", timeStyle: "short" })} (dansk tid)`;
}

/** Page-specific layout on top of the site's own tokens — no colour of its own. */
const PAGE_CSS = `
  .tk-table{width:100%;border-collapse:collapse;margin:22px 0 60px;font-size:14px}
  .tk-table th{text-align:left;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding:10px 12px;border-bottom:1px solid var(--border)}
  .tk-table td{padding:11px 12px;border-bottom:1px solid var(--border);vertical-align:top}
  .tk-table tr:hover td{background:var(--panel)}
  .tk-table code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--green);background:var(--panel);padding:2px 6px;border-radius:5px;margin:0 4px 4px 0;display:inline-block}
  .tk-status{color:var(--muted);margin-top:14px}
  .tk-status[data-status="error"],.tk-status[data-status="not_configured"]{color:var(--amber)}
`;

/** The /tickets page, in the site's own design (F038.30). */
export function renderTicketRegistryPage(state: RegistryState): string {
  let body: string;
  if (state.status === "not_configured") {
    body = `<p class="tk-status" data-testid="tickets-status" data-status="not_configured">${esc(state.message)}. Registret vises her, så snart BID's læse-endepunkt er live — BID er eneste kilde.</p>`;
  } else if (state.status === "error") {
    const last = state.lastGoodAt ? `Sidste gode svar: ${esc(daTime(state.lastGoodAt))}.` : "Der er aldrig hentet et godt svar.";
    body = `<p class="tk-status" data-testid="tickets-status" data-status="error">Kunne ikke hente fra BID: ${esc(state.error)}. ${last}</p>`;
  } else {
    const rows = state.rules
      .map(
        (r, i) =>
          `<tr data-testid="tickets-row-${i}"><td>${esc(r.app)}</td><td>${esc(TYPE_LABEL[r.type])}</td><td>${esc(r.audience)}</td><td>${r.scopes.map((s) => `<code>${esc(s)}</code>`).join(" ")}</td><td>${esc(daTime(r.since))}</td></tr>`,
      )
      .join("");
    body =
      `<p class="tk-status" data-testid="tickets-status" data-status="ok">${state.rules.length} regler fra BID · hentet ${esc(daTime(state.fetchedAt))}.</p>` +
      `<table class="tk-table" data-testid="tickets-table"><thead><tr><th>App/platform</th><th>Type</th><th>Modtager</th><th>Scopes</th><th>Siden</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return `<!doctype html><html lang="da" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="${FAVICON}"><title>BID-billetter — Discovery</title>
<style>${SITE_CSS}${PAGE_CSS}</style></head>
<body>${topBar({ active: "/tickets" })}
<div class="wrap"><main data-testid="tickets-root"><section class="hero"><h1><span class="at">Hvem logger ind med </span>BID-billetter</h1><p>Apps og platforme der beviser hvem de er med en BID-billet (workload identity) i stedet for en gemt nøgle. Læst live fra Broberg ID — ingen håndskrevet liste. Som data: <code>/api/tickets</code> · for AI: <code>/llms.txt</code>.</p></section>${body}</main></div>
<script>(function(){${THEME_JS}})();</script></body></html>`;
}

/** F038.30 — the same live list as a markdown section for /llms.txt and /llms-full.txt. */
export function renderTicketRegistryMarkdown(state: RegistryState): string {
  const head = "\n\n## Hvem logger ind med BID-billetter (live fra BID)\n\nApps og platforme der beviser hvem de er med en BID-billet (workload identity, F087) i stedet for en gemt nøgle. Læst live fra Broberg ID ved hver hentning af denne fil (cache højst 5 min). Som JSON: /api/tickets · side: /tickets.\n\n";
  if (state.status === "not_configured") return `${head}_${state.message}._\n`;
  if (state.status === "error") {
    return `${head}_Kunne ikke hente fra BID: ${state.error}. ${state.lastGoodAt ? `Sidste gode svar: ${state.lastGoodAt}.` : "Der er aldrig hentet et godt svar."} Listen er IKKE tom — den er ukendt lige nu._\n`;
  }
  const lines = state.rules.map((r) => `- **${r.app}** · ${TYPE_LABEL[r.type]} · modtager ${r.audience} · scopes ${r.scopes.join(", ")} · siden ${r.since.slice(0, 10)}`);
  return `${head}${state.rules.length} regler (BID genererede ${state.generatedAt}):\n\n${lines.join("\n")}\n`;
}
