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
  if (result?.sources?.osv !== "ok") return { open: [], close: [], couldNotCheck: true };
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
      `**Alvor:** ${w.severity}${w.kev === null ? " · CISA KEV kunne ikke læses" : w.kev ? " · på CISA KEV" : ""}`,
      "",
      `Fundet af det daglige afhængigheds-tjek (F082.9) ${result.checked_at}. Lukkes automatisk når hullet er væk fra alle pakker.`,
    ].join("\n"),
  }));
  const close = openIssues.filter((i) => { const id = idOf(i.title); return id && !wanted.has(id); });
  return { open, close, couldNotCheck: false };
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
}
