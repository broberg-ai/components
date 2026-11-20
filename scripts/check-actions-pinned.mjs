#!/usr/bin/env node
// F115.6 — every GitHub Action is pinned to a full commit SHA.
//
// A tag or branch is movable by whoever controls the action's repo: a compromised
// maintainer account re-points v4 and our next run executes their code with our
// secrets (the tj-actions/changed-files incident, March 2025). A 40-hex commit
// SHA cannot be re-pointed. The tag stays in a trailing comment for humans.
//
// Allowed without a SHA, by explicit rule:
//   · ./path          — a workflow or action in THIS commit
//   · broberg-ai/components/…@<release-tag> — our own reusable workflows, tagged
//     releases that callers pin on purpose (secret-gate-v1, image-hygiene-v1.0.10).
//     A branch ref (main, master, HEAD) is NOT allowed: it moves on every push.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SHA = /^[0-9a-f]{40}$/;
const BRANCHES = new Set(["main", "master", "HEAD", "develop"]);

/** → [{ line, uses, why }] for every unpinned `uses:` in one workflow's text. */
export function unpinned(text) {
  const bad = [];
  text.split("\n").forEach((raw, i) => {
    if (raw.trimStart().startsWith("#")) return;
    const m = raw.match(/^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)/);
    if (!m) return;
    const uses = m[1];
    if (uses.startsWith("./")) return;
    const at = uses.lastIndexOf("@");
    if (at < 0) return void bad.push({ line: i + 1, uses, why: "no ref at all" });
    const repo = uses.slice(0, at), ref = uses.slice(at + 1);
    if (SHA.test(ref)) return;
    if (repo.startsWith("broberg-ai/components/") && !BRANCHES.has(ref)) return;
    bad.push({ line: i + 1, uses, why: BRANCHES.has(ref) ? "a branch moves on every push" : "a tag can be re-pointed — pin the commit SHA" });
  });
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? ".github/workflows";
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  if (files.length === 0) { console.log(`::error::no workflows found in ${dir} — nothing was checked`); process.exit(1); }
  let bad = 0;
  for (const f of files) for (const b of unpinned(readFileSync(join(dir, f), "utf8"))) {
    bad++; console.log(`::error file=${join(dir, f)},line=${b.line}::${b.uses} — ${b.why}`);
  }
  console.log(`actions pinned: ${files.length} workflows · ${bad} unpinned`);
  process.exit(bad ? 1 : 0);
}
