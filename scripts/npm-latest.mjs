// F038.7 — ask the registry what shipped, and when.
//
// The "Just shipped" card used to be literal HTML. It named @broberg/stripe
// v0.2.0 from 2026-07-05 while three packages shipped on 2026-08-18 — six weeks
// and at least four releases stale, on the hero slot of the page the whole fleet
// is told to read first.
//
// A hardcoded value cannot report that it has gone stale, and neither can a
// hand-maintained `latest: true` flag: the next release forgets the flag exactly
// the way this one forgot line 401. The registry is the only source that cannot
// be out of date about its own publish times.
//
// FAILING IS THE FEATURE. Every error here throws. The tempting fallback — keep
// the previous card when the lookup fails — reproduces the defect precisely, with
// the added insult that a build step ran and reported success.

const REGISTRY = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org";

/**
 * F038.19 — "I could not ask" is a THIRD answer, not a wrong one. A network
 * failure or a 5xx means the registry did not answer; a 4xx or a document with
 * no latest version means it answered something wrong. Still thrown — a build
 * must never crown a card from a partial answer — but typed, so a GATE can turn
 * it into a warning that names what was not verified, the way
 * check-roster-versions.mjs already does (exit 2).
 */
export class NpmUnreachableError extends Error {
  /** @param {string[]} packages @param {number} total */
  constructor(packages, total, causes) {
    super(`npm registry did not answer for ${packages.length} of ${total} package(s): ${packages.join(", ")}${causes ? ` (${causes})` : ""}`);
    this.name = "NpmUnreachableError";
    this.packages = packages;
    this.total = total;
  }
}
class Unreachable extends Error {}

/** One package's published truth. Throws — never returns a partial answer. */
async function fetchOne(pkg) {
  const url = `${REGISTRY}/${pkg.replace("/", "%2F")}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new Unreachable(`${pkg}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status >= 500) throw new Unreachable(`${pkg}: HTTP ${res.status}`);
  if (!res.ok) throw new Error(`npm lookup failed for ${pkg}: HTTP ${res.status}`);
  const doc = await res.json();
  const version = doc?.["dist-tags"]?.latest;
  const published = version ? doc?.time?.[version] : undefined;
  if (!version || !published) {
    throw new Error(`npm lookup for ${pkg} returned no latest version or publish time`);
  }
  // F038.31 / F038.43 — published via Trusted Publisher (OIDC). npm records that on
  // the version itself as _npmUser.trustedPublisher. A provenance attestation is NOT
  // the same signal: npm only attaches one when the publishing repo is PUBLIC.
  // Measured 25/10: @broberg/lens-daemon 0.1.34 was published by Trusted Publisher
  // from the private broberg-ai/lens with no attestation, and the page said
  // «ingen provenance». Either signal counts; event-log 0.1.0 (local bootstrap,
  // _npmUser = a person) still has neither.
  const v = doc?.versions?.[version];
  const provenance = Boolean(v?._npmUser?.trustedPublisher || v?.dist?.attestations?.provenance);
  return { pkg, version, published, provenance };
}

// F038.46 — the docs-stale check rebuilds once with EXTERNAL packages frozen to the
// committed docs/npm-meta.json, so a release from another repo (lens, auth-relay,
// ai-sdk …) is told apart from a change in this repo. Only that check sets the env;
// every normal build still asks the registry about everything.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Names of the packages PUBLISHED FROM THIS REPO (a packages/*\/package.json here). */
export function ownPackages() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages");
  return new Set(
    readdirSync(dir)
      .map((d) => join(dir, d, "package.json"))
      .filter((f) => existsSync(f))
      .map((f) => JSON.parse(readFileSync(f, "utf8")).name),
  );
}

function frozenExternal() {
  const file = process.env.DISCOVERY_FREEZE_EXTERNAL;
  if (!file) return null;
  return { meta: JSON.parse(readFileSync(file, "utf8")), own: ownPackages() };
}

/** Every package's latest release, newest first. Throws if ANY lookup fails —
 *  a partial answer would silently crown the wrong package. */
export async function fetchLatestReleases(packages) {
  const unique = [...new Set(packages)];
  const frozen = frozenExternal();
  const settled = await Promise.allSettled(
    unique.map(async (pkg) => {
      const m = frozen && !frozen.own.has(pkg) ? frozen.meta[pkg] : undefined;
      if (m?.version && m?.publishedAt) {
        return { pkg, version: m.version, published: m.publishedAt, provenance: m.provenance === "yes" };
      }
      return fetchOne(pkg);
    }),
  );
  // A WRONG answer wins over an absent one: it is a finding, the other is not.
  const wrong = settled.find((r) => r.status === "rejected" && !(r.reason instanceof Unreachable));
  if (wrong) throw wrong.reason;
  const unreachable = settled.flatMap((r, i) => (r.status === "rejected" ? [unique[i]] : []));
  if (unreachable.length) {
    const first = settled.find((r) => r.status === "rejected").reason.message;
    throw new NpmUnreachableError(unreachable, unique.length, first);
  }
  return settled.map((r) => r.value).sort((a, b) => b.published.localeCompare(a.published));
}
