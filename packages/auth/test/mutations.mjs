#!/usr/bin/env node
// F008.13 — mutation pass for the ceremony-only passkey entry.
//
//   node test/mutations.mjs
//
// WHAT THIS PROVES, and it is AC#3 rather than a general nicety: breaking the
// REGISTRATION half of the user-verification guard must redden a DIFFERENTLY
// NAMED test than breaking the AUTHENTICATION half. @broberg/auth 0.5.0 shipped
// exactly that asymmetry — the authentication half enforced, the registration
// half a request the server never checked — so a credential could be enrolled
// unverified and then fail every single sign-in. A suite where one mutation
// kills everything cannot tell those two halves apart.
//
// Mutations are applied to a COPY. The real source is never written to, so an
// interrupted run cannot leave a mutant on disk, and no marker is needed.
// Every mutation asserts its ANCHOR applied: a substitution that silently
// matched nothing reads exactly like a surviving mutant.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(PKG, "src", "passkey-ceremony.ts");
const BACKUP = join(PKG, "src", ".passkey-ceremony.original.ts");
const original = readFileSync(SRC, "utf8");

const MUTATIONS = [
  {
    name: "the REGISTRATION half of the UV guard is removed",
    find: `        assertUserVerified(verification.registrationInfo.userVerified, "register");`,
    replace: `        // mutated`,
    // 0.5.0's real defect: enrol unverified, then fail every login.
    expectRed: ["REGISTRATION refuses a UV=0 response"],
    expectGreen: ["AUTHENTICATION refuses a UV=0 assertion"],
  },
  {
    name: "the AUTHENTICATION half of the UV guard is removed",
    find: `        assertUserVerified(verification.authenticationInfo.userVerified, "sign in");`,
    replace: `        // mutated`,
    expectRed: ["AUTHENTICATION refuses a UV=0 assertion", "REFUSES the same signature with the UV bit cleared"],
    expectGreen: ["REGISTRATION refuses a UV=0 response"],
  },
  {
    name: "the guard fails OPEN on a missing userVerified field (=== false instead of !== true)",
    find: `    if (userVerified === true) return;`,
    replace: `    if (userVerified !== false) return;`,
    expectRed: ["fails CLOSED on a MISSING userVerified"],
  },
  {
    name: "the guard is on even when not asked for (the default is ignored)",
    find: `    if (!requireUserVerification) return;`,
    replace: `    if (false) return;`,
    // The negative control is what dies here — without it, "the guard works"
    // and "the guard is always on" are the same green.
    expectRed: ["NEGATIVE CONTROL"],
  },
  {
    name: "the userId comes from the REQUEST BODY instead of the challenge we issued",
    find: `        const userId = rec.userId!;`,
    replace: `        const userId = ((response as { userId?: string })?.userId) ?? rec.userId!;`,
    expectRed: ["userId from the CHALLENGE"],
  },
  {
    name: "the challenge is not required to match its ceremony",
    find: `    if (rec.ceremony !== ceremony) {`,
    replace: `    if (false) {`,
    expectRed: ["cannot be spent on an authentication"],
  },
  {
    name: "an expired challenge is accepted",
    find: `    if (rec.expiresAt <= now()) {`,
    replace: `    if (false) {`,
    expectRed: ["refuses an expired challenge"],
  },
  {
    name: "another user's credential may answer a targeted challenge",
    find: `        if (rec.userId !== undefined && rec.userId !== stored.userId) {`,
    replace: `        if (false) {`,
    expectRed: ["another user's credential cannot answer"],
  },
  {
    name: "re-registering an existing credential silently reassigns it",
    find: `        if (await store.getCredential(cred.id)) {`,
    replace: `        if (false) {`,
    expectRed: ["re-registering the same credential"],
  },
  {
    name: "the browser is asked for a verification the server will not enforce",
    find: `            userVerification: requireUserVerification ? "required" : "preferred",`,
    replace: `            userVerification: "preferred",`,
    expectRed: ["asks the browser for a verification only when it will enforce one"],
  },
  {
    name: "base64url emits standard base64 (+ and /), breaking a URL and a cookie",
    find: `const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";`,
    replace: `const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";`,
    // The REAL-CRYPTO file is what makes this interesting: an encoding change
    // has to break an actual signature verification, not just a string compare.
    expectRed: ["emits no +", "real ES256 assertion"],
  },
  {
    name: "the stored public key is truncated by one byte",
    find: `          publicKey: toBase64Url(cred.publicKey),`,
    replace: `          publicKey: toBase64Url(cred.publicKey.slice(0, -1)),`,
    // Nothing in the stubbed suite can see this — only a REGISTRATION with real
    // crypto can, and this mutation is why that test exists. It survived until
    // the round-trip test was written.
    expectRed: ["REGISTERS with a real attestation"],
  },
];

function runSuite() {
  let out;
  try {
    out = execFileSync("npx", ["vitest", "run", "test/passkey-ceremony.test.ts", "test/passkey-ceremony-real-crypto.test.ts", "--reporter=verbose"], {
      cwd: PKG, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    out = String(e.stdout ?? "") + String(e.stderr ?? "");
  }
  return out.split("\n").filter((l) => /^\s*×/.test(l)).map((l) => l.trim().replace(/^×\s*/, ""));
}

copyFileSync(SRC, BACKUP);
let failures = 0;
try {
  const baseline = runSuite();
  if (baseline.length) {
    console.log(`✗ the suite is RED before any mutation — nothing below means anything:\n  ${baseline.join("\n  ")}`);
    process.exit(1);
  }
  console.log("baseline: all green\n");

  for (const m of MUTATIONS) {
    const hits = original.split(m.find).length - 1;
    if (hits !== 1) {
      console.log(`  ✗ ${m.name}\n      ANCHOR matched ${hits} times, expected 1 — the mutation did not apply, which is`);
      console.log(`      indistinguishable from a surviving mutant unless asserted.`);
      failures++;
      continue;
    }

    writeFileSync(SRC, original.replace(m.find, m.replace));
    const red = runSuite();
    writeFileSync(SRC, original);

    const missingRed = (m.expectRed ?? []).filter((n) => !red.some((r) => r.includes(n)));
    const wrongGreen = (m.expectGreen ?? []).filter((n) => red.some((r) => r.includes(n)));

    if (!red.length) {
      console.log(`  ✗ ${m.name}\n      SURVIVED — no test noticed.`);
      failures++;
    } else if (missingRed.length || wrongGreen.length) {
      console.log(`  ✗ ${m.name}`);
      console.log(`      red: ${red.length} test(s)`);
      if (missingRed.length) console.log(`      expected RED and were not: ${missingRed.join(" · ")}`);
      if (wrongGreen.length) console.log(`      expected GREEN and went red: ${wrongGreen.join(" · ")}`);
      failures++;
    } else {
      console.log(`  ✓ ${m.name}`);
      console.log(`      killed by ${red.length}: ${red.slice(0, 3).map((r) => r.slice(0, 62)).join(" · ")}`);
    }
  }
} finally {
  // The read-back is the guard, not the copy. A restore that silently failed
  // would leave a mutant in the tree and every later run would measure it.
  copyFileSync(BACKUP, SRC);
  rmSync(BACKUP, { force: true });
  if (readFileSync(SRC, "utf8") !== original) {
    console.log("\n✗✗ RESTORE FAILED — src/passkey-ceremony.ts is NOT the original. Do not commit.");
    process.exit(2);
  }
}

console.log(failures ? `\n${failures} mutation(s) unproven\n` : `\n${MUTATIONS.length} mutations, all killed\n`);
process.exit(failures ? 1 : 0);
