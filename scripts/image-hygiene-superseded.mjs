#!/usr/bin/env node
// F105.8 — is this hygiene run still allowed to deploy, or has newer code overtaken it?
//
//   node scripts/image-hygiene-superseded.mjs <releases.json> <runStartedMs> <runSha> <branchHeadSha|""> <onDefaultBranch 1|0>
//     → { skip, reason, winner }
//
// Measured on cardmem 23/10 2026 (#4199): a run started on 9e79dca2, a normal CI deploy
// of e6dc8467 landed while the image built, and the run then deployed its OLDER image on
// top — production went backwards and everything was green. The rule: when in doubt, do
// not deploy. A skipped night costs nothing; a rollback costs the newest code.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function superseded({ releases, runStartedMs, runSha, branchHeadSha, onDefaultBranch }) {
  if (!Array.isArray(releases)) return { skip: true, reason: "releases unreadable", winner: null };
  const latest = [...releases].sort((a, b) => (b.Version ?? 0) - (a.Version ?? 0))[0];
  if (latest) {
    const created = Date.parse(latest.CreatedAt ?? "");
    if (Number.isNaN(created)) return { skip: true, reason: "latest release has no readable CreatedAt", winner: `v${latest.Version}` };
    if (created > runStartedMs) {
      return { skip: true, reason: "superseded", winner: `release v${latest.Version} (${latest.ImageRef ?? "?"}) deployed during this run` };
    }
  }
  if (onDefaultBranch) {
    if (!branchHeadSha) return { skip: true, reason: "default branch head unreadable", winner: null };
    if (branchHeadSha !== runSha) {
      return { skip: true, reason: "superseded", winner: `default branch moved to ${branchHeadSha.slice(0, 8)} during this run` };
    }
  }
  return { skip: false, reason: null, winner: null };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, started, runSha, head, onDefault] = process.argv.slice(2);
  let releases = null;
  try { releases = JSON.parse(readFileSync(file, "utf8")); } catch { releases = null; }
  console.log(JSON.stringify(superseded({
    releases,
    runStartedMs: Number(started),
    runSha: runSha ?? "",
    branchHeadSha: head || null,
    onDefaultBranch: onDefault === "1",
  })));
}
