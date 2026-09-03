// F008.9 — the guard the package should have had before it shipped.
//
// It packs the package, installs it in an EMPTY directory with ONLY the peers
// it declares as non-optional, and imports every entry in the exports map. A
// package whose manifest says a peer is optional and whose import graph
// requires it fails here, loudly, before a consumer discovers it.
//
//   node verify-clean-install.mjs
//
// TWO PROPERTIES THAT MAKE IT A GUARD RATHER THAN A GESTURE:
//
//   · The entry list comes from package.json "exports", never from a hand-written
//     array. A wrong list silently shrinks what was looked at, and that is
//     precisely how this defect shipped — the same failure this repo hit with
//     greppable, and cardmem hit with a top-level-only directory scan.
//   · The peer list comes from peerDependenciesMeta. So the check does not ask
//     "does it work with everything installed" (it always does); it asks "is the
//     manifest telling the truth", which is the actual claim being made.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = new URL("./", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"));

const peers = Object.entries(pkg.peerDependencies ?? {});
const optional = pkg.peerDependenciesMeta ?? {};
const required = peers.filter(([name]) => !optional[name]?.optional).map(([name, range]) => `${name}@${range}`);
const skipped = peers.filter(([name]) => optional[name]?.optional).map(([name]) => name);

// Each entry's declared COST — the optional peers a consumer must add to use it.
// An entry may legitimately require an optional peer (that is what a per-feature
// subpath is FOR); what it may not do is require one the manifest never mentions.
// Declaring it as data rather than prose is what makes "install cost is knowable
// before installing" checkable instead of a README promise.
const entryPeers = pkg.entryPeers ?? {};
const subs = Object.keys(pkg.exports ?? {});
const undeclared = subs.filter((s) => !(s in entryPeers));
if (undeclared.length) {
  console.error(
    `::error::these exports have no entryPeers declaration: ${undeclared.join(", ")}\n` +
      `Every entry must state what it costs — an undeclared one is exactly how an ` +
      `optional peer becomes mandatory without anyone noticing.`,
  );
  process.exit(1);
}

const entries = subs.map((sub) => ({
  sub,
  spec: sub === "." ? pkg.name : `${pkg.name}/${sub.replace(/^\.\//, "")}`,
  extra: entryPeers[sub] ?? [],
}));

console.log(`package        ${pkg.name}@${pkg.version}`);
console.log(`required peers ${required.join(", ") || "(none)"}`);
console.log(`NOT installed  ${skipped.join(", ") || "(none)"}   ← declared optional`);
console.log(`entries        ${entries.length}\n`);

const tarball = execFileSync("npm", ["pack", "--silent"], { cwd: HERE }).toString().trim().split("\n").pop();
const dir = mkdtempSync(join(tmpdir(), "auth-clean-"));

let failures = 0;
try {
  execFileSync("npm", ["init", "-y"], { cwd: dir, stdio: "ignore" });
  execFileSync("npm", ["pkg", "set", "type=module"], { cwd: dir, stdio: "ignore" });

  // THE LOCKFILE MUST BE BUILT HERE, NEVER INHERITED OR FROZEN.
  //
  // Raised by torrent-search-api after it nearly cost them a false bug report
  // against this package: they measured @better-auth/passkey still present after
  // `bun remove` + `bun install --frozen-lockfile`, and were one message away
  // from telling us the 0.2.0 release was broken. It was their lockfile — the
  // remove took the entry out of package.json and left the resolution in
  // bun.lock, and --frozen-lockfile faithfully installed what the stale file
  // asked for. `rm -rf node_modules bun.lock && bun install` → gone, 142 → 111
  // packages.
  //
  // So: a frozen lockfile PROVES NOTHING about what a package requires. It is a
  // replay of a file that may be out of date. This guard resolves from scratch
  // in an empty directory precisely so its answer is about the PACKAGE and not
  // about someone's history — and that property is asserted rather than left to
  // whoever next "optimises" this by caching the directory.
  for (const lock of ["package-lock.json", "bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock"]) {
    if (existsSync(join(dir, lock))) {
      throw new Error(
        `${lock} exists before install — this check must resolve from scratch. ` +
          `A replayed lockfile answers "what did we install last time", not "what does this package require".`,
      );
    }
  }

  execFileSync("npm", ["i", "--no-audit", "--no-fund", join(HERE, tarball), ...required], {
    cwd: dir,
    stdio: "pipe",
  });

  // Cheapest entries first, so each install is additive and the run stays quick.
  for (const { spec, extra } of [...entries].sort((a, b) => a.extra.length - b.extra.length)) {
    if (extra.length) {
      execFileSync("npm", ["i", "--no-audit", "--no-fund", ...extra], { cwd: dir, stdio: "pipe" });
    }
    // Import in a CHILD process: one entry throwing must not stop the rest, and
    // a partial answer here would be its own false green.
    try {
      // A JSON export needs the import attribute — without it Node throws
      // ERR_IMPORT_ATTRIBUTE_MISSING and the entry reads as broken when it is
      // fine. F061.3 added "./package.json" to all 39 packages so a consumer
      // can answer "what version am I?", and this guard has been RED ever
      // since — caught only because F008.10 added the next entry and someone
      // ran it. A gate whose red nobody sees is a gate nobody depends on.
      const importExpr = spec.endsWith(".json")
        ? `await import(${JSON.stringify(spec)}, { with: { type: "json" } })`
        : `await import(${JSON.stringify(spec)})`;
      execFileSync(process.execPath, ["--input-type=module", "-e", importExpr], {
        cwd: dir,
        stdio: "pipe",
      });
      console.log(`  ok    ${spec}${extra.length ? `   (+ ${extra.join(", ")})` : ""}`);
    } catch (err) {
      failures++;
      const msg =
        String(err.stderr ?? err.message)
          .split("\n")
          .find((l) => /Error|Cannot find/.test(l)) ?? "import failed";
      console.log(`  FAIL  ${spec}${extra.length ? `   (+ ${extra.join(", ")})` : ""}\n          ${msg.trim()}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(HERE, tarball), { force: true });
}

console.log("");
if (failures) {
  console.error(
    `::error::${failures} of ${entries.length} entries cannot be imported with only the ` +
      `non-optional peers installed.\n` +
      `Either the import graph must stop requiring an OPTIONAL peer (move it behind its own ` +
      `subpath), or peerDependenciesMeta must stop calling a REQUIRED peer optional. ` +
      `Right now the manifest and the code disagree, and the installer believes the manifest.`,
  );
  process.exit(1);
}
console.log(
  `✓ all ${entries.length} entries import with exactly their declared peers — ` +
    `nothing costs more than the manifest says.`,
);
