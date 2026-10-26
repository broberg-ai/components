#!/usr/bin/env node
// F038.46 — the frozen-external rebuild that lets the docs-stale check tell an
// external release apart from a change in this repo. Proven against a stub
// registry that COUNTS what it is asked, so "frozen" is measured, not assumed.
//
// The end-to-end run (a fake newer lens-daemon behind a proxy → ::warning:: exit 0;
// the same plus an edit to inventory-data → ::error:: exit 1) was done by hand on
// 26/10 and is recorded on the card; it needs the real registry and a full build.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ownPackages } from "./npm-latest.mjs";
import { movedExternals } from "./check-docs-stale.mjs";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
};

const own = ownPackages();
const ours = [...own][0];
const theirs = "@broberg/not-published-here";
check("ownPackages() reads packages/*/package.json (non-empty, contains @broberg/theme)", own.size > 10 && own.has("@broberg/theme"));
check("an external name is not own", !own.has(theirs));

// movedExternals: only externals, only when version or time moved.
{
  const committed = { [ours]: { version: "1.0.0", publishedAt: "a" }, [theirs]: { version: "1.0.0", publishedAt: "a" } };
  const live = { [ours]: { version: "2.0.0", publishedAt: "b" }, [theirs]: { version: "1.1.0", publishedAt: "b" } };
  check("movedExternals names the external that moved and never our own", JSON.stringify(movedExternals(committed, live, own)) === JSON.stringify([`${theirs} 1.0.0 → 1.1.0`]));
  check("movedExternals is empty when nothing external moved", movedExternals(committed, { ...live, [theirs]: committed[theirs] }, own).length === 0);
}

// fetchLatestReleases with DISCOVERY_FREEZE_EXTERNAL: externals from the file, own asked live.
const asked = [];
const server = createServer((req, res) => {
  const pkg = decodeURIComponent(req.url.slice(1));
  asked.push(pkg);
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
    "dist-tags": { latest: "5.0.0" }, time: { "5.0.0": "2026-10-26T00:00:00.000Z" }, versions: { "5.0.0": {} },
  }));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const registry = `http://127.0.0.1:${server.address().port}`;
const frozen = join(mkdtempSync(join(tmpdir(), "freeze-")), "meta.json");
writeFileSync(frozen, JSON.stringify({ [theirs]: { version: "1.2.3", publishedAt: "2026-01-01T00:00:00.000Z", provenance: "yes" } }));

const runFetch = (env) => new Promise((ok) => {
  const code = `import("./scripts/npm-latest.mjs").then(async (m) => console.log(JSON.stringify(await m.fetchLatestReleases(${JSON.stringify([ours, theirs])}))))`;
  const p = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, NPM_REGISTRY: registry, ...env } });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.on("close", () => ok(JSON.parse(out || "[]")));
});

{
  asked.length = 0;
  const r = await runFetch({ DISCOVERY_FREEZE_EXTERNAL: frozen });
  const t = r.find((x) => x.pkg === theirs), o = r.find((x) => x.pkg === ours);
  check("frozen: the external package comes from the file (1.2.3), not the registry", t?.version === "1.2.3" && t?.provenance === true, JSON.stringify(t));
  check("frozen: the registry was NOT asked about the external package", !asked.includes(theirs), JSON.stringify(asked));
  check("frozen: our own package is still asked live (5.0.0)", o?.version === "5.0.0" && asked.includes(ours));
}
{
  asked.length = 0;
  const r = await runFetch({});
  check("without the env, every package is asked live (normal builds unchanged)", asked.includes(theirs) && asked.includes(ours) && r.find((x) => x.pkg === theirs)?.version === "5.0.0");
}
server.close();

if (failed) { console.error(`\n✗ ${failed} check(s) failed`); process.exit(1); }
console.log("\n✓ docs-stale: own/external split, moved list, frozen fetch (3) + live fetch");
