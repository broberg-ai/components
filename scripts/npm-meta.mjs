// F038.31 — what a package card says about npm: the link, when the latest version
// was published (Danish time), and whether it was published via Trusted Publisher.
// One module, used by the landing page, llms.txt and /api/packages.

/** "22.10.2026 kl. 23.40 (dansk tid)" — named zone; a build server runs UTC. */
export function daTime(iso) {
  const d = new Date(iso ?? "");
  if (Number.isNaN(d.getTime())) return null;
  // Assembled from parts, not toLocaleString's own string: measured, Node renders
  // "23.10.2026, 00.40" and Bun "23.10.2026 00.40" for the same instant, so the
  // page would differ by which runtime built it.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day}.${parts.month}.${parts.year} kl. ${parts.hour}.${parts.minute} (dansk tid)`;
}

/** The meta for one package, or `unknown` when npm did not tell us. */
export function npmMeta(pkg, releases) {
  const r = (releases ?? []).find((x) => x.pkg === pkg);
  return r
    ? { npmUrl: `https://www.npmjs.com/package/${pkg}`, version: r.version, publishedAt: r.published, provenance: r.provenance ? "yes" : "no" }
    : { npmUrl: `https://www.npmjs.com/package/${pkg}`, version: null, publishedAt: null, provenance: "unknown" };
}

export const PROVENANCE_LABEL = { yes: "Trusted Publisher ✓", no: "ingen provenance", unknown: "provenance ukendt" };

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The row on a package card. `fid` is the card's F-number in lower case. */
export function npmMetaRow(fid, meta) {
  const when = daTime(meta.publishedAt);
  return `<div class="c-npm"><a href="${esc(meta.npmUrl)}" target="_blank" rel="noopener" data-testid="card-npm-${esc(fid)}" onclick="event.stopPropagation()">npm ↗</a><span class="c-pub" data-testid="card-published-${esc(fid)}">${when ? `udgivet ${esc(when)}` : "udgivelsestid ukendt"}</span><span class="c-tp c-tp-${meta.provenance}" data-testid="card-provenance-${esc(fid)}" title="Målt som npm provenance på seneste version">${PROVENANCE_LABEL[meta.provenance]}</span></div>`;
}

/** The same facts as one markdown fragment for llms.txt. */
export function npmMetaMd(meta) {
  const when = daTime(meta.publishedAt);
  return `${meta.npmUrl} · ${when ? `udgivet ${when}` : "udgivelsestid ukendt"} · ${PROVENANCE_LABEL[meta.provenance]}`;
}
