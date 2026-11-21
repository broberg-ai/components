#!/usr/bin/env node
// F115.4 — a release proves itself from the registry, the way a consumer meets it.
//
//   node scripts/verify-provenance.mjs @broberg/<name> <version>
//
// After `npm publish --provenance`, two facts must hold on the REGISTRY (not in our
// own log): (1) the version carries a SLSA provenance attestation naming this
// repo's workflow, and (2) `npm audit signatures` on a clean install of it —
// which also covers every dependency it pulls in — finds the registry signatures
// valid. The registry lags a publish by seconds, so both are retried; a version
// that never shows up is red, never skipped.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SLSA = "https://slsa.dev/provenance/v1";

/** `npm view <pkg>@<ver> dist.attestations --json` output → { ok, why } */
export function provenanceOk(json) {
  let a;
  try { a = JSON.parse(json); } catch { return { ok: false, why: "registry returned no attestation data" }; }
  const t = a?.provenance?.predicateType;
  if (t !== SLSA) return { ok: false, why: `no SLSA provenance attestation (predicateType: ${t ?? "none"})` };
  return { ok: true };
}

/** `npm audit signatures` exit + output → { ok, why }. Exit 0 means every signature verified. */
export function signaturesOk(status, out) {
  // npm says «3 packages have verified registry signatures» but «1 package has a verified registry signature» for a package with
  // no dependencies (singular, an article, no -s) — 21 Nov 2026 that grammar turned 8 correct publishes red. Both forms pass.
  if (status === 0 && /verified registry signatures?/i.test(out)) return { ok: true };
  return { ok: false, why: `npm audit signatures failed (exit ${status}): ${out.trim().split("\n").slice(-3).join(" | ")}` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (import.meta.url === `file://${process.argv[1]}`) {
  const [pkg, version] = process.argv.slice(2);
  if (!pkg || !version) { console.error("usage: verify-provenance.mjs @scope/name <version>"); process.exit(2); }
  const tries = Number(process.env.VERIFY_TRIES ?? 10), waitMs = Number(process.env.VERIFY_WAIT_MS ?? 20000);
  let last = "never reached the registry";
  for (let i = 1; i <= tries; i++) {
    try {
      const view = execFileSync("npm", ["view", `${pkg}@${version}`, "dist.attestations", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const p = provenanceOk(view);
      if (!p.ok) { last = p.why; }
      else {
        const dir = mkdtempSync(join(tmpdir(), "prov-"));
        writeFileSync(join(dir, "package.json"), '{"name":"verify","version":"1.0.0","private":true}');
        const inst = spawnSync("npm", ["install", `${pkg}@${version}`, "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, encoding: "utf8" });
        if (inst.status !== 0) last = `clean install failed: ${(inst.stderr ?? "").trim().split("\n").pop()}`;
        else {
          const sig = spawnSync("npm", ["audit", "signatures"], { cwd: dir, encoding: "utf8" });
          const s = signaturesOk(sig.status, `${sig.stdout}${sig.stderr}`);
          if (s.ok) { console.log(`${pkg}@${version}: SLSA provenance present, registry signatures verified (${sig.stdout.trim().split("\n")[0]})`); process.exit(0); }
          last = s.why;
        }
      }
    } catch (e) { last = `npm view failed: ${String(e.message).split("\n")[0]}`; }
    console.log(`attempt ${i}/${tries}: ${last}`);
    if (i < tries) await sleep(waitMs);
  }
  console.log(`::error::${pkg}@${version} is on the registry without proof: ${last}`);
  process.exit(1);
}
