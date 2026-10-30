// F038.7 — the guard. Reads the GENERATED page and asks npm whether the hero
// card names the newest release. Run it against the site's own output, never
// against the generator's intent.
//
//   node scripts/check-featured-fresh.mjs [path-or-url]
//
// Default: docs/inventory.html. Pass an https:// URL to check the LIVE site,
// which is the only thing that proves a deploy landed — flyctl has printed a
// not-listening WARNING and then reported success (F038.6).
import { readFileSync } from "node:fs";
import { DATA } from "./inventory-data.mjs";
import { fetchLatestReleases, ownPackages } from "./npm-latest.mjs";
import { featuredVerdict, releaseTag, OK } from "./featured-verdict.mjs";
import { discoveryAuth } from "./discovery-auth.mjs";
// F038.22 — Discovery is behind login. CI reads it as a registered session:
// F038.26: a BrobergID ticket (GitHub OIDC, no stored key) — see discovery-auth.mjs.
const auth = await discoveryAuth({
  env: process.env,
  getTicket: async () => (await import("../packages/sso/src/fetch-ticket.ts")).fetchTicket({ audience: "discovery", scope: "discovery:read" }),
});
console.log(`  door: ${auth.door}${auth.note ? ` (${auth.note})` : ""}`);
const DISCOVERY_AUTH = auth.init;


const target = process.argv[2] ?? new URL("../docs/inventory.html", import.meta.url);

/**
 * F038.9 — "the site did not answer" and "the card is stale" are two findings,
 * and they send the reader to two different places.
 *
 * This used to be `await (await fetch(url)).text()`. A 502 or a 404 returns an
 * error PAGE, `.text()` succeeds, the regex finds no card, and the script threw
 * «could not find the "Just shipped" card» — which reads as a broken generator
 * and is not. This guard exists precisely for a misbehaving endpoint: its own
 * header notes that flyctl printed a not-listening WARNING and then reported
 * success (F038.6). It was the one case it could not describe.
 */
async function readTarget(t) {
  if (!String(t).startsWith("http")) return readFileSync(t, "utf8");
  const res = await fetch(String(t), DISCOVERY_AUTH);
  if (!res.ok) {
    // Deliberately says nothing about the card. Naming it here is what sent
    // someone to the wrong file.
    console.error(`\n  ${res.status} ${res.statusText} from ${t}\n  The site did not answer; nothing was checked.\n`);
    process.exit(1);
  }
  return res.text();
}

const html = await readTarget(target);

const m = html.match(/Just shipped<\/div>\s*<h2>([^<]*)<\/h2>\s*<div class="pkg">(@broberg\/[a-z0-9-]+) · v([0-9][^ ]*) /);
if (!m) throw new Error(`could not find the "Just shipped" card in ${target}`);
const [, headline, pkg, version] = m;

const pkgs = DATA.flatMap((L) => L.items ?? [])
  .filter((it) => it.s === "shipped" && String(it.pkg ?? "").startsWith("@broberg/"))
  .map((it) => it.pkg);
const newest = (await fetchLatestReleases(pkgs))[0];

/** F038.48 — the evidence: this run's start and the publish runs for the newest's tag. */
async function publishEvidence(tag) {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return { githubError: "not running in GitHub Actions with a token" };
  const gh = async (path) => {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, { headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
    return r.json();
  };
  try {
    const run = await gh(`/actions/runs/${GITHUB_RUN_ID}`);
    const runs = await gh(`/actions/workflows/publish.yml/runs?branch=${encodeURIComponent(tag)}&per_page=10`);
    // A LATER discovery run on main supersedes this one (it deploys a newer commit).
    const later = await gh(`/actions/workflows/inventory-fresh.yml/runs?branch=main&per_page=20&created=${encodeURIComponent(`>${run.created_at}`)}`);
    const laterRuns = (later.workflow_runs ?? []).filter((r) => r.id !== run.id && r.event !== "pull_request");
    return { runStartedAt: run.run_started_at, publishRuns: runs.workflow_runs ?? [], laterRuns };
  } catch (e) {
    return { githubError: String(e.message ?? e) };
  }
}

const own = ownPackages();
const stale = pkg !== newest.pkg || version !== newest.version;
const evidence = stale && own.has(newest.pkg) ? await publishEvidence(releaseTag(newest.pkg, newest.version)) : {};
const verdict = featuredVerdict({ card: { pkg, version }, newest, own, ...evidence });

if (verdict.code !== OK) {
  // Name BOTH, so the gap is legible rather than a bare false. The card was six
  // weeks stale and said so to nobody.
  console.error(
    `\n  "Just shipped" is stale.\n` +
      `    card   ${pkg}@${version}   (${headline})\n` +
      `    newest ${newest.pkg}@${newest.version}   published ${newest.published}\n` +
      `  ${verdict.message}\n`,
  );
  process.exit(verdict.code);
}
console.log(`✓ "Just shipped" names the newest release: ${pkg}@${version} (${newest.published})`);
