/**
 * Is our checked-in `src/schema.ts` still what cronjobs.webhouse.net publishes?
 *
 * WHY THIS EXISTS (F041.3). `npm run gen` pulls the live spec ONCE, by hand, and
 * nothing afterwards notices when the contract moves. On 2026-08-28 cronjobs
 * reported FOUR public-API changes in a single day — two of which had already
 * made our types wrong (`connectTimeout` missing; the execution-status union
 * missing `deferred` and `missed`, so a consumer typed from this package could
 * not represent the server's own output). The only reason we knew is that
 * somebody on the other side chose to write to us.
 *
 * A signal that exists only while a person remembers to send it is not a signal.
 * Their spec is public, authless and updated in the same commit as their code,
 * so drift is one HTTP GET away.
 *
 * THREE OUTCOMES, NEVER TWO:
 *
 *   in_sync        our schema matches the live spec
 *   drifted        it does not — regenerate
 *   could_not_ask  we could not reach or parse the spec
 *
 * The third is the one this file is really about. "Could not ask" must never
 * read as in_sync (a green that never looked), and must not read as drifted
 * either — a red that fires on a flaky connection is a red that gets ignored,
 * and then the real drift is ignored along with it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SPEC_URL = "https://cronjobs.webhouse.net/api/openapi.json";

export const EXIT = { in_sync: 0, drifted: 1, could_not_ask: 2 };

/**
 * The generated file opens with an auto-generated banner whose wording differs
 * between the CLI and the programmatic API. Everything below it is byte-identical
 * (measured), so the banner is stripped rather than compared.
 */
function body(source) {
  return source.replace(/^\/\*\*[\s\S]*?\*\/\s*/, "").trim();
}

function firstDifference(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return { line: i + 1, live: x[i] ?? "(end of file)", ours: y[i] ?? "(end of file)" };
  }
  return null;
}

/**
 * @param {object} deps
 * @param {() => Promise<unknown>} deps.fetchSpec  resolves the parsed OpenAPI document
 * @param {(spec: unknown) => Promise<string>} deps.generate  spec -> TypeScript source
 * @param {() => string} deps.readCurrent  the checked-in schema.ts
 */
export async function checkContractDrift({ fetchSpec, generate, readCurrent }) {
  let spec;
  try {
    spec = await fetchSpec();
  } catch (err) {
    return { status: "could_not_ask", note: `could not reach ${SPEC_URL}: ${message(err)}` };
  }
  if (!spec || typeof spec !== "object") {
    // A 200 carrying HTML (a proxy error page, a login redirect) parses to
    // something that is not a spec. Treated as "could not ask", NOT as drift:
    // regenerating from it would replace our types with nothing.
    return { status: "could_not_ask", note: "the spec URL answered, but not with an OpenAPI document" };
  }

  let live;
  try {
    live = await generate(spec);
  } catch (err) {
    return { status: "could_not_ask", note: `the spec could not be turned into types: ${message(err)}` };
  }

  const ours = readCurrent();
  const a = body(live);
  const b = body(ours);
  if (a === b) return { status: "in_sync", note: "src/schema.ts matches the published contract" };

  const diff = firstDifference(a, b);
  return {
    status: "drifted",
    note: "the published contract no longer matches src/schema.ts — run `npm run gen`",
    diff,
  };
}

function message(err) {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  const schemaPath = new URL("../src/schema.ts", import.meta.url);
  const result = await checkContractDrift({
    fetchSpec: async () => {
      // A hung request must become "could not ask", not a job that never ends.
      const res = await fetch(SPEC_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    generate: async (spec) => {
      const { default: openapiTS, astToString } = await import("openapi-typescript");
      return astToString(await openapiTS(spec));
    },
    readCurrent: () => readFileSync(schemaPath, "utf8"),
  });

  const label = { in_sync: "✓", drifted: "✗ DRIFTED", could_not_ask: "? COULD NOT ASK" }[result.status];
  console.log(`${label}  ${result.note}`);
  if (result.diff) {
    console.log(`  first difference at line ${result.diff.line}`);
    console.log(`    published: ${result.diff.live}`);
    console.log(`    ours:      ${result.diff.ours}`);
  }
  process.exit(EXIT[result.status]);
}
