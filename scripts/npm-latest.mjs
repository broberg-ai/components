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

/** One package's published truth. Throws — never returns a partial answer. */
async function fetchOne(pkg) {
  const url = `${REGISTRY}/${pkg.replace("/", "%2F")}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new Error(`npm lookup failed for ${pkg}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`npm lookup failed for ${pkg}: HTTP ${res.status}`);
  const doc = await res.json();
  const version = doc?.["dist-tags"]?.latest;
  const published = version ? doc?.time?.[version] : undefined;
  if (!version || !published) {
    throw new Error(`npm lookup for ${pkg} returned no latest version or publish time`);
  }
  return { pkg, version, published };
}

/** Every package's latest release, newest first. Throws if ANY lookup fails —
 *  a partial answer would silently crown the wrong package. */
export async function fetchLatestReleases(packages) {
  const unique = [...new Set(packages)];
  const results = await Promise.all(unique.map(fetchOne));
  return results.sort((a, b) => b.published.localeCompare(a.published));
}
