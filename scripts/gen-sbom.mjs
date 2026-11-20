#!/usr/bin/env node
// F115.4 — a CycloneDX 1.5 SBOM of exactly what a package SHIPS to its consumers.
//
//   node scripts/gen-sbom.mjs packages/<name> [--out sbom.cdx.json]
//
// Built from pnpm-lock.yaml (the same walk dependency-health measures with), so the
// SBOM and the vulnerability verdict describe the SAME dependency set. Components
// carry a purl and the lockfile's integrity hash. Deterministic: same lockfile and
// package.json → identical bytes (no timestamp, no random serial — the serial is a
// UUIDv5-style hash of the content), so a diff of two SBOMs is a diff of the tree.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { lockedShipped } from "./dependency-health.mjs";

export function purl(nameAtVersion) {
  const at = nameAtVersion.lastIndexOf("@");
  const name = nameAtVersion.slice(0, at), version = nameAtVersion.slice(at + 1);
  const enc = (s) => s.replace(/^@/, "%40");
  return `pkg:npm/${enc(name)}@${version}`;
}

/** integrity "sha512-<base64>" → CycloneDX hash entry, or null */
function hashOf(integrity) {
  const m = /^(sha512|sha256|sha1)-(.+)$/.exec(integrity ?? "");
  if (!m) return null;
  return { alg: { sha512: "SHA-512", sha256: "SHA-256", sha1: "SHA-1" }[m[1]], content: Buffer.from(m[2], "base64").toString("hex") };
}

export function buildSbom(lock, dir, pkgJson) {
  if (!lock?.importers?.[dir]) throw new Error(`${dir} is not in pnpm-lock.yaml importers — an SBOM of nothing would read as «no dependencies»`);
  const shipped = lockedShipped(lock, dir, Object.keys(pkgJson.dependencies ?? {}));
  const components = [...shipped].sort().map((nv) => {
    const h = hashOf(lock?.packages?.[nv]?.resolution?.integrity);
    return { type: "library", "bom-ref": purl(nv), name: nv.slice(0, nv.lastIndexOf("@")), version: nv.slice(nv.lastIndexOf("@") + 1), purl: purl(nv), ...(h ? { hashes: [h] } : {}) };
  });
  const root = { type: "library", "bom-ref": purl(`${pkgJson.name}@${pkgJson.version}`), name: pkgJson.name, version: pkgJson.version, purl: purl(`${pkgJson.name}@${pkgJson.version}`) };
  const body = { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { component: root }, components };
  const serial = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return { ...body, serialNumber: `urn:uuid:${serial.slice(0, 8)}-${serial.slice(8, 12)}-${serial.slice(12, 16)}-${serial.slice(16, 20)}-${serial.slice(20, 32)}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir || dir.startsWith("--")) { console.error("usage: gen-sbom.mjs packages/<name> [--out file]"); process.exit(2); }
  const { parse } = await import("yaml");
  const lock = parse(readFileSync("pnpm-lock.yaml", "utf8"));
  let sbom, pkgJson;
  try { pkgJson = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")); sbom = buildSbom(lock, dir, pkgJson); }
  catch (e) { console.error(`::error::${e.message}`); process.exit(1); }
  const i = process.argv.indexOf("--out");
  const text = JSON.stringify(sbom, null, 2) + "\n";
  if (i > 0) writeFileSync(process.argv[i + 1], text); else process.stdout.write(text);
  console.error(`sbom ${pkgJson.name}@${pkgJson.version}: ${sbom.components.length} components`);
}
