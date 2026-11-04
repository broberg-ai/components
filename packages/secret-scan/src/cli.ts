#!/usr/bin/env node
/// <reference types="node" />
// F090.6 — `secret-scan --stdin`: the CLI door asked for by cardmem's fleet git gate
// (F036.23), so a hook does not have to embed a `node -e` script.
//
//   git diff --cached | secret-scan --stdin
//
// Prints WHERE (label + line), never the value. Exit 1 = a secret was found,
// 0 = nothing on the axes this scanner examines, 2 = it could not scan.
import { redactSecrets } from "./index.js";

export function scanText(text: string): { label: string; line: number | null }[] {
  const hits: { label: string; line: number | null }[] = [];
  const perLine = new Map<string, number>();
  text.split("\n").forEach((line, i) => {
    for (const f of redactSecrets(line).findings) {
      hits.push({ label: f.label, line: i + 1 });
      perLine.set(f.label, (perLine.get(f.label) ?? 0) + f.count);
    }
  });
  // A secret that spans lines (a PEM key) is only visible to the whole-text pass.
  for (const f of redactSecrets(text).findings) {
    if ((perLine.get(f.label) ?? 0) < f.count) hits.push({ label: f.label, line: null });
  }
  return hits;
}

async function main(argv: string[]): Promise<number> {
  if (!argv.includes("--stdin")) {
    process.stderr.write("usage: secret-scan --stdin   (reads text on stdin; exit 1 = secret found, 0 = none, 2 = error)\n");
    return 2;
  }
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const hits = scanText(Buffer.concat(chunks).toString("utf8"));
  for (const h of hits) process.stderr.write(`secret-scan: ${h.label} ${h.line === null ? "(spans several lines)" : `line ${h.line}`}\n`);
  if (hits.length) process.stderr.write(`secret-scan: ${hits.length} finding(s) — values not shown. Remove the secret; if it was ever committed or pushed, ROTATE it.\n`);
  return hits.length ? 1 : 0;
}

const isMain = process.argv[1] && /secret-scan|cli\.(c?js|ts)$/.test(process.argv[1]);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => { process.stderr.write(`secret-scan: could not scan: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); },
  );
}
