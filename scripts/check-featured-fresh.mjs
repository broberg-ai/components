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
import { fetchLatestReleases } from "./npm-latest.mjs";

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
  const res = await fetch(String(t));
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

if (pkg !== newest.pkg || version !== newest.version) {
  // Name BOTH, so the gap is legible rather than a bare false. The card was six
  // weeks stale and said so to nobody.
  console.error(
    `\n  "Just shipped" is stale.\n` +
      `    card   ${pkg}@${version}   (${headline})\n` +
      `    newest ${newest.pkg}@${newest.version}   published ${newest.published}\n`,
  );
  process.exit(1);
}
console.log(`✓ "Just shipped" names the newest release: ${pkg}@${version} (${newest.published})`);
