#!/usr/bin/env node
// F082.9 — turn the daily check's high/critical OSV findings into GitHub issues.
//
//   node scripts/dependency-alarm.mjs data/dependency-health.json
//
// One issue per hole, keyed by «[<id>]» at the start of the title (the same key
// BID's advisory-watch uses, so F082.10 can take these over unchanged). An issue
// is closed when its hole is gone from every package. A run where OSV could not
// be asked opens nothing and closes nothing — «could not check» is not «fixed» —
// and exits 1, so the run is red.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const LABEL = "dependency-alarm";

/** @param {any} result data/dependency-health.json
 *  @param {{number:number,title:string}[]} openIssues issues with LABEL, state open */
export function planIssues(result, openIssues) {
  if (result?.sources?.osv !== "ok") return { open: [], close: [], inbox: [], couldNotCheck: true };
  const wanted = new Map();
  for (const [pkg, row] of Object.entries(result.packages ?? {})) {
    if (row.osv?.status !== "ok") continue;
    for (const f of row.osv.findings ?? []) {
      if (f.severity !== "critical" && f.severity !== "high") continue;
      const w = wanted.get(f.id) ?? { ...f, packages: [] };
      w.packages.push(`${pkg}@${row.version}`);
      wanted.set(f.id, w);
    }
  }
  const idOf = (title) => /^\[([^\]]+)\]/.exec(title)?.[1] ?? null;
  const have = new Set(openIssues.map((i) => idOf(i.title)).filter(Boolean));
  const open = [...wanted.values()].filter((w) => !have.has(w.id)).map((w) => ({
    id: w.id,
    title: `[${w.id}] ${w.dep} — ${w.severity}${w.malicious ? ", ONDSINDET PAKKE" : ""}${w.kev ? ", udnyttes aktivt (CISA KEV)" : ""}`,
    body: [
      `${w.summary}`.trim(),
      "",
      `**Hul:** https://osv.dev/vulnerability/${w.id}`,
      `**Afhængighed:** \`${w.dep}\` (låst i pnpm-lock.yaml)`,
      `**Leveres af:** ${w.packages.map((p) => `\`${p}\``).join(", ")}`,
      `**Rettet i:** ${w.fixed?.length ? w.fixed.map((f) => `\`${f}\``).join(", ") : "ingen rettet version endnu"}`,
      `**Alvor:** ${w.severity}${w.kev === null ? " · CISA KEV kunne ikke læses" : w.kev ? " · på CISA KEV" : ""}`,
      "",
      `Fundet af det daglige afhængigheds-tjek (F082.9) ${result.checked_at}. Lukkes automatisk når hullet er væk fra alle pakker.`,
    ].join("\n"),
  }));
  const close = openIssues.filter((i) => { const id = idOf(i.title); return id && !wanted.has(id); });
  // cardmem dedups on external_ref, so EVERY current hole is sent every run: a
  // known one returns the same idea without a new wake, a new one lands once.
  const inbox = [...wanted.values()].map((w) => ({
    external_ref: `osv:${w.id}`,
    tags: ["security", "dependency-alarm", "F082.9"],
    text: `Sårbarhed ${w.id} (${w.severity}${w.malicious ? ", ondsindet pakke" : ""}${w.kev ? ", udnyttes aktivt" : ""}) i ${w.dep}, leveret af ${w.packages.join(", ")}. Rettet i: ${w.fixed?.length ? w.fixed.join(", ") : "ingen rettet version endnu"}. ${w.summary} https://osv.dev/vulnerability/${w.id}`.trim(),
  }));
  return { open, close, inbox, couldNotCheck: false };
}

export const INBOX_URL = "https://www.cardmem.com/api/board/idea";

/** Post one finding to cardmem's Inbox; throws unless cardmem took it. */
export async function postInbox(item, key, fetchImpl = fetch) {
  const r = await fetchImpl(INBOX_URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(item) });
  if (!r.ok) throw new Error(`cardmem inbox HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = JSON.parse(readFileSync(process.argv[2] ?? "data/dependency-health.json", "utf8"));
  gh(["label", "create", LABEL, "--color", "B60205", "--description", "F082.9 — sårbarhed i en afhængighed en @broberg-pakke leverer", "--force"]);
  const openIssues = JSON.parse(gh(["issue", "list", "--label", LABEL, "--state", "open", "--limit", "500", "--json", "number,title"]));
  const plan = planIssues(result, openIssues);
  if (plan.couldNotCheck) {
    console.log(`::error::OSV could not be asked — nothing opened or closed: ${Object.values(result.packages ?? {}).find((r) => r.osv?.error)?.osv.error ?? "unknown"}`);
    process.exit(1);
  }
  for (const o of plan.open) {
    gh(["issue", "create", "--label", LABEL, "--title", o.title, "--body", o.body]);
    console.log(`::error::opened ${o.title}`);
  }
  for (const c of plan.close) {
    gh(["issue", "close", String(c.number), "--comment", `Hullet er ikke længere i nogen @broberg-pakke (dagligt tjek ${result.checked_at}).`]);
    console.log(`closed #${c.number} ${c.title}`);
  }
  console.log(`${plan.open.length} opened · ${plan.close.length} closed · ${openIssues.length - plan.close.length} still open`);
  // Ship dark: without the key the issues above still stand; say so, loudly.
  const key = process.env.CARDMEM_INBOX_KEY;
  if (!key) console.log("::warning::CARDMEM_INBOX_KEY not set — findings were not sent to cardmem's Inbox");
  else {
    for (const item of plan.inbox) await postInbox(item, key);
    console.log(`${plan.inbox.length} sent to cardmem's Inbox`);
  }
}
