// Mutation harness for @broberg/mail-identity. NOT part of the published
// package and not run by `pnpm test` — invoke it directly:
//
//   node test/mutations.mjs
//
// It reverts each security decision in src/index.ts one at a time, runs the
// suite, and prints which tests went red for each. A green suite proves nothing
// on its own; the useful property is that every mutation reddens a DIFFERENT,
// non-overlapping set of tests. A mutation that reddens everything only proves
// the suite runs, and a mutation that reddens nothing means the decision is
// untested.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";

const SRC = new URL("../src/index.ts", import.meta.url);
const OUT = new URL("../.mutations.json", import.meta.url);
const original = readFileSync(SRC, "utf8");

const MUTATIONS = [
  {
    name: "substring match (the original from.includes(owner))",
    from: `  const present = new Set(extractAddresses(field).map((a) => splitPlusTag(a).address));
  if (present.size === 0) return false;

  const list = typeof known === "string" ? [known] : known;
  return list.some((k) =>
    extractAddresses(k).some((a) => present.has(splitPlusTag(a).address)),
  );`,
    to: `  const list = typeof known === "string" ? [known] : known;
  return list.some((k) => (field ?? "").toLowerCase().includes(k.toLowerCase()));`,
  },
  {
    name: "split the address field without understanding quotes",
    from: `  const { masked } = maskQuotedAndComments(field);`,
    to: `  const masked = field;`,
  },
  {
    name: "\\b anchor (a dot is a word boundary)",
    from: "`(?<=^|[\\\\s;,])${method}",
    to: "`\\\\b${method}",
  },
  {
    name: "denylist anchor (?<![\\w.-]) — the first fix, which did not hold",
    from: "`(?<=^|[\\\\s;,])${method}",
    to: "`(?<![\\\\w.-])${method}",
  },
  {
    name: "read the auth header without masking quotes and comments",
    from: `  const { masked, malformed } = maskQuotedAndComments(header);`,
    to: `  const masked = header;
  const malformed = false;`,
  },
  {
    name: "first verdict wins (an injected pass drowns out the real fail)",
    from: `    const verdicts = [...masked.matchAll(re)].map((m) => m[1]!.toLowerCase());`,
    to: `    const verdicts = [...masked.matchAll(re)].map((m) => m[1]!.toLowerCase()).slice(0, 1);`,
  },
  {
    name: "collapse 'conflicted' into 'fail' (the policy moves into the reader)",
    from: `    if (passed > 0 && passed < verdicts.length) conflicted.push(method);`,
    to: `    void passed;`,
  },
];

function failingTests() {
  if (existsSync(OUT)) rmSync(OUT);
  try {
    execFileSync(
      "npx",
      ["vitest", "run", "--reporter=json", `--outputFile=${OUT.pathname}`],
      { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe" },
    );
  } catch {
    // A failing suite exits non-zero — that is the expected case here.
  }
  if (!existsSync(OUT)) throw new Error("vitest produced no report");
  const report = JSON.parse(readFileSync(OUT, "utf8"));
  const failed = [];
  for (const file of report.testResults ?? []) {
    for (const t of file.assertionResults ?? []) {
      if (t.status === "failed") failed.push(t.fullName ?? t.title);
    }
  }
  rmSync(OUT);
  return failed.sort();
}

const baseline = failingTests();
if (baseline.length > 0) {
  console.error(`baseline is not green (${baseline.length} failing) — fix that first`);
  for (const t of baseline) console.error(`  ${t}`);
  process.exit(1);
}
console.log(`baseline: green\n`);

const results = [];
for (const m of MUTATIONS) {
  if (!original.includes(m.from)) {
    console.error(`::error::mutation anchor not found — "${m.name}"`);
    console.error("The source moved and this mutation silently stopped mutating anything.");
    writeFileSync(SRC, original);
    process.exit(1);
  }
  writeFileSync(SRC, original.replace(m.from, m.to));
  const failed = failingTests();
  writeFileSync(SRC, original);
  results.push({ name: m.name, failed });

  console.log(`${failed.length === 0 ? "NOT CAUGHT" : `${failed.length} red`}  ${m.name}`);
  for (const t of failed) console.log(`    ${t}`);
  console.log("");
}

// Restored byte-identically, checked rather than assumed.
if (readFileSync(SRC, "utf8") !== original) {
  console.error("::error::src/index.ts was not restored");
  process.exit(1);
}

const uncaught = results.filter((r) => r.failed.length === 0);
const identical = [];
for (let i = 0; i < results.length; i++) {
  for (let j = i + 1; j < results.length; j++) {
    const a = results[i].failed.join("|");
    const b = results[j].failed.join("|");
    if (a === b) identical.push(`${results[i].name}  ==  ${results[j].name}`);
  }
}

console.log("— summary —");
console.log(`mutations: ${results.length}`);
console.log(`uncaught : ${uncaught.length}`);
console.log(`identical red sets: ${identical.length}`);
for (const p of identical) console.log(`  ${p}`);
console.log("source restored byte-identically: yes");

if (uncaught.length > 0 || identical.length > 0) process.exit(1);
