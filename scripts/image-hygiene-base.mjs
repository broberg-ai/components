#!/usr/bin/env node
// F105.4 — what the deployed image is BUILT ON: the distro (from the image's own
// /etc/os-release) and the base image (the Dockerfile's last FROM).
//   node scripts/image-hygiene-base.mjs <os-release file> <Dockerfile>  → { base_os, base_image }
// Never throws on the CLI path: an unknown answer is null, and the run goes on.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** "debian 12", "alpine 3.20.3" — ID + VERSION_ID; null when there is no ID. */
export function parseOsRelease(text) {
  const vals = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) vals[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  if (!vals.ID) return null;
  return vals.VERSION_ID ? `${vals.ID} ${vals.VERSION_ID}` : vals.ID;
}

/** The image in the LAST FROM — the stage that runs. Skips --flags and "AS name". */
export function lastFrom(dockerfile) {
  let last = null;
  // Join line continuations so a wrapped FROM is still one instruction.
  const text = String(dockerfile ?? "").replace(/\\\r?\n/g, " ");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^FROM\s/i.test(line)) continue;
    const image = line.split(/\s+/).slice(1).find((t) => !t.startsWith("--"));
    if (image) last = image;
  }
  return last;
}

function readOrNull(path) {
  try { return path ? readFileSync(path, "utf8") : null; } catch { return null; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [osPath, dfPath] = process.argv.slice(2);
  const os = readOrNull(osPath);
  const df = readOrNull(dfPath);
  console.log(JSON.stringify({ base_os: os == null ? null : parseOsRelease(os), base_image: df == null ? null : lastFrom(df) }));
}
