#!/usr/bin/env node
// F033.11 — mutation pass for the Fly infra path.
//
// Every mutation here RESTORES a defect that shipped in 0.1.0. That is the
// point: the suite is only evidence if putting the old code back turns it red,
// and each defect must redden a DIFFERENT named test — otherwise one test is
// carrying all of them and four of the five are decoration.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
// F033.12 — TWO files now. The SPA fallback lives in the server we GENERATE
// (fly-live-assets.ts); a harness that can only reach fly-live.ts cannot prove
// it, and would have reported 0 uncaught while covering none of it.
const FILES = {
  "fly-live": join(PKG, "src", "deploy", "fly-live.ts"),
  "fly-live-assets": join(PKG, "src", "deploy", "fly-live-assets.ts"),
};
const FILE = FILES["fly-live"]; // default for a mutation that names no file

// A mutant left on disk by a killed run is indistinguishable from real source.
const dirty = execFileSync("git", ["status", "--porcelain", "--", ...Object.values(FILES)], { cwd: PKG }).toString().trim();
if (dirty) {
  console.error(
    `refusing to mutate an uncommitted file:\n${dirty}\n` +
      "  Commit first: a killed run skips the restore, and mutated source then\n" +
      "  reads exactly like working source.",
  );
  process.exit(1);
}

const MUTATIONS = [
  {
    // F033.12 — the trap in the obvious implementation. Without the extension
    // guard a dropped /assets/app-abc123.js answers index.html with 200, the
    // browser fails on a parse error naming the wrong problem, and an
    // INCOMPLETE DEPLOY LOOKS LIKE A WORKING ONE. That trades a visible 404 for
    // an invisible one, which is worse than the bug being fixed.
    name: "the extension guard is dropped (a missing .js answers index.html, 200)",
    file: "fly-live-assets",
    from: '  const last = pathname.split("/").filter(Boolean).pop() || "";\n  return !last.includes(".");',
    to: "  return true;",
    expect: ["A MISSING ASSET STILL 404s"],
  },
  {
    // The one that matters most: the BYTES were already reachable via 404.html.
    // It was the NUMBER that was wrong — a success reported as a failure.
    name: "the SPA fallback answers 404 instead of 200 (the 404.html defect, restored)",
    file: "fly-live-assets",
    from: '      try { await access(join(CURRENT, "index.html")); return fileResponse(join(CURRENT, "index.html")); } catch {}',
    to: '      try { await access(join(CURRENT, "index.html")); return fileResponse(join(CURRENT, "index.html"), 404); } catch {}',
    expect: ["an unknown ROUTE answers index.html with STATUS 200"],
  },
  {
    // The other half of the predicate. Without the Accept clause a fetch() for a
    // missing JSON endpoint receives HTML with a 200 and fails far away from here.
    name: "the Accept clause is dropped (a JSON fetch gets HTML)",
    file: "fly-live-assets",
    from: '  if (!accept.includes("text/html")) return false;',
    to: "",
    expect: ["a NON-BROWSER client on an extensionless path still gets its 404"],
  },
  {
    // Default-on, restored. A static-site consumer relying on a real 404 would
    // silently begin serving 200 for every typo — fifteen live sites at once.
    name: "the fallback defaults ON (every existing deploy changes behaviour)",
    file: "fly-live-assets",
    from: 'const SPA_FALLBACK = process.env.SPA_FALLBACK === "true";',
    to: 'const SPA_FALLBACK = process.env.SPA_FALLBACK !== "false";',
    expect: ["answers exactly as it does today"],
  },
  {
    // THE DEFECT. helpdesk's 32-byte HMAC secret was in their log in plaintext
    // before it had been used for anything, because it was an argument.
    name: "the secret goes back into argv (`secrets set KEY=value`)",
    from: '    execFileSync("flyctl", ["secrets", "import", "--stage", "--app", config.appName], {',
    to: '    execFileSync("flyctl", ["secrets", "set", `SYNC_SECRET=${config.syncSecret}`, "--stage", "--app", config.appName], {',
    expect: ["no argument of any flyctl invocation contains the secret"],
  },
  {
    // The other half, and the half helpdesk's own proposed remedy would not
    // have fixed: flyctl echoing the value back on a failure.
    name: "the redactor is a pass-through (flyctl's own output leaks the value)",
    from: "  return text.split(secret).join(\"«SYNC_SECRET redacted»\");",
    to: "  return text;",
    expect: ["a FAILING secrets call does not reproduce the secret"],
  },
  {
    // Remove the preflight: a missing app goes back to dying on a GraphQL error
    // three commands later, wearing someone else's name.
    name: "the app-exists preflight is dropped (a missing app fails somewhere else)",
    from: "    assertAppExists(config.appName, tmpDir);",
    to: "",
    expect: ["names the situation and the exact command"],
  },
  {
    // The URL stops being a claim we checked and goes back to being one we made.
    name: "the returned URL is not verified (a dead app reports success)",
    from: "    await verifyLive(",
    to: "    if (false) await verifyLive(",
    expect: ["throws when the health endpoint never answers"],
  },
  {
    // helpdesk hit this on BOTH their apps: the deploy reports success and
    // <app>.fly.dev resolves nowhere.
    name: "IP allocation is left to the deploy again",
    from: "    ensurePublicIps(config.appName, tmpDir);",
    to: "",
    expect: ["allocates v6 and shared v4 when the app has none"],
  },
  {
    // The empty catch, restored. A volume that failed for a real reason reads
    // as "already exists", and the app runs with no persistent storage.
    name: "a volume listing failure is swallowed (silent data loss)",
    from: '    throw new Error(`could not list volumes for app "${config.appName}": ${res.stderr.trim()}`);',
    to: "    return;",
    expect: ["stops the deploy instead of running without storage"],
  },
  {
    // helpdesk's wrong call, restored: a missing appName reaches the remedy and
    // prints `flyctl apps create undefined --org …` — right shape, invented
    // content, copyable.
    name: 'the missing-config guard is dropped (a remedy names an app called undefined)',
    from: "  assertRequiredConfig(config);",
    to: "",
    expect: ["does not build a command about an app called undefined"],
  },
  {
    // The other direction: a guard that refuses everything would pass the test
    // above and break every real caller.
    name: 'the guard refuses a COMPLETE config too (the over-strict direction)',
    from: "    (k) => typeof config?.[k] !== 'string' || config[k].trim() === '',",
    to: "    () => true,",
    expect: ["the guard must not reject valid input"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "deploymut-"));
const originals = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, readFileSync(f, "utf8")]));
for (const [k, f] of Object.entries(FILES)) copyFileSync(f, join(backup, `${k}.ts`));
const original = originals["fly-live"];

const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
let uncaught = 0;
const redSets = [];

writeMarker({ harness: "@broberg/deploy-core test/mutations.mjs", file: FILE });
try {
  for (const m of MUTATIONS) {
    const src = originals[m.file ?? "fly-live"];
    if (!src.includes(m.from)) {
      console.log(`ANCHOR MISSING - ${m.name}`);
      console.log("  the substitution matched nothing, so this mutation was never applied");
      uncaught++;
      continue;
    }
    const mutated = src.replace(m.from, m.to);
    if (mutated === src) {
      console.log(`ANCHOR NO-OP - ${m.name}`);
      uncaught++;
      continue;
    }

    writeFileSync(FILES[m.file ?? "fly-live"], mutated);
    let out = "";
    let died = false;
    try {
      execFileSync("pnpm", ["exec", "vitest", "run"], { cwd: PKG, stdio: "pipe" });
    } catch (e) {
      out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
      died = true;
    } finally {
      writeFileSync(FILES[m.file ?? "fly-live"], originals[m.file ?? "fly-live"]);
      assertRestored({ harness: "@broberg/deploy-core test/mutations.mjs", file: FILES[m.file ?? "fly-live"], expected: originals[m.file ?? "fly-live"] });
    }

    if (!died) {
      console.log(`UNCAUGHT - ${m.name}`);
      console.log("  the suite stayed GREEN with this mutation applied");
      uncaught++;
      continue;
    }

    const clean = out.replace(ANSI, "");
    const red = [
      ...new Set(
        clean
          .split("\n")
          .filter((l) => /^\s*(×|✕|FAIL)/.test(l))
          // STRIP THE DURATION (F080.4). vitest appends "10ms" to each failing
          // line, and the identical-red-set check below compares these strings —
          // so two mutations reddening exactly the SAME tests compared unequal
          // whenever one run was a millisecond slower. Measured in @broberg/mail:
          // "0 identical" locally, "1" in CI, same mutations, same counts. The CI
          // answer was the true one, and the collision was real.
          .map((l) => l.trim().replace(/\s+\d+(?:\.\d+)?m?s$/, "")),
      ),
    ];

    // "the suite died but I cannot see WHICH test" is a third state, and it must
    // not be reported as "the mutation survived". They are opposite facts.
    if (red.length === 0) {
      console.log(`UNREADABLE - ${m.name}`);
      console.log("  the suite FAILED (so the mutation WAS caught) but no failing test line");
      console.log("  could be parsed. That is a defect in this harness, not evidence about the code.");
      clean.split("\n").filter(Boolean).slice(-6).forEach((l) => console.log(`     ${l.trim()}`));
      uncaught++;
      redSets.push(`unreadable:${m.name}`);
      continue;
    }

    const hit = m.expect.every((e) => red.some((l) => l.includes(e)));
    redSets.push(red.join("|"));
    console.log(`  ${hit ? "caught   " : "WRONG RED"} ${m.name}  -> ${red.length} red`);
    red.slice(0, 3).forEach((l) => console.log(`               . ${l}`));
    if (!hit) {
      console.log(`     expected all of: ${m.expect.join(" . ")}`);
      uncaught++;
    }
  }
} finally {
  for (const [k, f] of Object.entries(FILES)) {
    copyFileSync(join(backup, `${k}.ts`), f);
    assertRestored({ harness: "@broberg/deploy-core test/mutations.mjs", file: f, expected: originals[k] });
  }
  rmSync(backup, { recursive: true, force: true });
  clearMarker();
}

// AN IDENTICAL RED SET IS A FAILURE, NOT A WARNING (F080.4). It used to print
// and leave the exit code alone, so the one thing it measures — that each
// mutation is proven by something of its OWN — could not block anything. A real
// collision was found in @broberg/mail the day this changed: two mutations, one
// proof, and whichever was actually guarded, the other was riding on it.
// NAME the pair rather than sending the reader back through every mutation.
const collisions = [];
{
  const seen = new Map();
  redSets.forEach((sig, i) => {
    if (seen.has(sig)) collisions.push([MUTATIONS[seen.get(sig)].name, MUTATIONS[i].name, sig]);
    else seen.set(sig, i);
  });
}
if (collisions.length) {
  console.log("\nIDENTICAL RED SETS - one test is carrying both mutations, so only one of them is proven:");
  for (const [a, b, sig] of collisions) {
    console.log(`  . ${a}`);
    console.log(`  . ${b}`);
    sig.split("|").forEach((l) => console.log(`      both reddened: ${l}`));
  }
}
console.log(
  `\n${collisions.length || uncaught ? "FAIL" : "OK"} - ${MUTATIONS.length} mutations, ${uncaught} uncaught, ${collisions.length} identical red set(s)`,
);
process.exit(uncaught === 0 && collisions.length === 0 ? 0 : 1);
