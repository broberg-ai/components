#!/usr/bin/env node
// F115.8 — what is IN the tarball a package publishes.
//
//   node scripts/check-tarball-contents.mjs packages/<name>      one package (publish job)
//   node scripts/check-tarball-contents.mjs --all                 every public package
//
// sso has had a gate on its packed artefact since F084.50; this is that idea for
// all of them. `npm pack --dry-run --json` lists exactly the files npm would
// publish, so the answer is about the shipped artefact, not the source tree.
// Red on a file that must never leave the house: env files, private keys,
// credentials, npm auth, database files, and anything under .git or .claude.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  [/(^|\/)\.env(\.|$)/i, "an env file"],
  [/(^|\/)\.npmrc$/, "an npm auth file"],
  [/\.(pem|key|p12|pfx|jks|keystore)$/i, "a private key / certificate store"],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, "an SSH key"],
  [/(^|\/)(credentials?|secrets?)(\.[a-z]+)?$/i, "a credentials/secrets file"],
  [/\.(sqlite3?|db)$/i, "a database file"],
  [/(^|\/)\.(git|claude|ssh|aws)(\/|$)/, "a tooling/credential directory"],
];
const MAX_BYTES = 25 * 1024 * 1024;

/** files: [{ path, size }] → [{ path, why }] */
export function offenders(files, totalSize = 0) {
  const out = [];
  for (const f of files) for (const [re, why] of FORBIDDEN) if (re.test(f.path)) { out.push({ path: f.path, why }); break; }
  if (totalSize > MAX_BYTES) out.push({ path: "(tarball)", why: `unpacked size ${totalSize} B exceeds ${MAX_BYTES} B` });
  return out;
}

export function packList(dir) {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64e6 });
  const j = JSON.parse(raw)[0];
  if (!j || !Array.isArray(j.files) || j.files.length < 2) throw new Error(`npm pack lists only package.json for ${dir} — a tarball with nothing in it is not a clean one`);
  return { files: j.files, size: j.unpackedSize ?? 0, name: j.name, version: j.version };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = process.argv.includes("--all");
  const dirs = all
    ? readdirSync("packages").map((d) => `packages/${d}`).filter((d) => existsSync(`${d}/package.json`) && !JSON.parse(readFileSync(`${d}/package.json`, "utf8")).private)
    : [process.argv[2]].filter(Boolean);
  if (dirs.length === 0) { console.log("::error::no package given — nothing was checked"); process.exit(1); }
  let bad = 0;
  for (const d of dirs) {
    try {
      const { files, size, name, version } = packList(d);
      const o = offenders(files, size);
      console.log(`${(name ?? d).padEnd(34)} ${String(files.length).padStart(4)} files · ${o.length ? o.length + " OFFENDING" : "clean"}`);
      for (const x of o) { bad++; console.log(`::error::${name ?? d}@${version}: ${x.path} — ${x.why}`); }
    } catch (e) { bad++; console.log(`::error::${d}: could not check — ${e.message.split("\n")[0]}`); }
  }
  process.exit(bad ? 1 : 0);
}
