// F427.1 — the dependency measurement: lockfiles → shipped / all trees → OSV → findings.
// The network half. decide.mjs judges what comes out; this only gathers it, and any failure is returned as an
// ERROR (never as «no findings»).
import { findLockfiles, readLockfile } from "./lockfiles.mjs";
import { queryOsv, readKev, osvSeverity } from "../dependency-health.mjs";
import { isMalicious } from "./decide.mjs";

/**
 * @param {string} root   directory to scan
 * @param {object} o      { exclude: string[] (path prefixes), skipImporters: string[], yamlParse, fetchImpl? }
 * @returns {Promise<{lockfiles: object[], findings: object[], errors: string[], unsupported: string[]}>}
 */
export async function measureDeps(root, o) {
  const errors = [];
  const found = findLockfiles(root, o.exclude ?? []);
  const unsupported = found.filter((l) => !l.supported).map((l) => l.path);
  const lockfiles = [];
  const trees = []; // {lock, shipped:Set, all:Set}
  for (const lf of found.filter((l) => l.supported)) {
    try {
      const t = readLockfile(root, lf, o.yamlParse, o.skipImporters ?? []);
      trees.push({ lock: lf.path, ...t });
      lockfiles.push({ path: lf.path, kind: lf.kind, shipped: t.shipped.size, all: t.all.size, nonRegistry: t.nonRegistry.length });
    } catch (e) { errors.push(`${lf.path}: ${String(e.message).split("\n")[0]}`); }
  }
  if (trees.length === 0 && errors.length === 0) {
    // No supported lockfile at all. A repo with a package.json has been caught by `install`; here it is only said out loud.
    return { lockfiles, findings: [], errors, unsupported, empty: true };
  }
  const union = new Set(trees.flatMap((t) => [...t.all]));
  let vulns, kev = null;
  try {
    vulns = await queryOsv(union, o.fetchImpl ?? fetch);
    kev = await readKev(o.fetchImpl ?? fetch);
  } catch (e) { return { lockfiles, findings: [], errors: [...errors, `OSV: ${e.message}`], unsupported }; }
  const shippedAnywhere = new Set(trees.flatMap((t) => [...t.shipped]));
  const lockOf = (dep) => trees.find((t) => t.all.has(dep))?.lock ?? "";
  const findings = [];
  const seen = new Set();
  for (const [dep, list] of vulns) for (const v of list) {
    const k = `${v.id}|${dep}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const aliases = v.aliases ?? [];
    findings.push({
      id: v.id, aliases, dep, severity: osvSeverity(v), summary: v.summary ?? "",
      malicious: isMalicious(v), shipped: shippedAnywhere.has(dep), lock: lockOf(dep),
      kev: kev ? aliases.some((a) => kev.has(a)) : null,
    });
  }
  return { lockfiles, findings, errors, unsupported };
}
