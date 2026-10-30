// F038.48 — what a stale "Just shipped" card MEANS, decided on evidence.
//
// Measured over 40 discovery runs (25–30 Oct 2026): four reds, each with the
// newest release published minutes before or DURING the run, each green on the
// next run. A guard red on every busy release day trains its reader to skip it —
// and the day the card is genuinely stale looks identical.
//
//   0 ok       the card names npm's newest
//   1 stale    RED — ours, and its publish finished before this run started;
//              or GitHub could not be asked (an unanswered question is not evidence)
//   3 pending  ours, and EITHER its publish run is still going or finished AFTER
//              this run started (that publish triggers its own discovery run), OR a
//              LATER discovery run on main exists — it deploys a newer commit (the
//              roster bump) and checks the card again, so this answer is superseded.
//              Measured 27 Oct: bodymap 0.13.3's publish finished 17:21:37 and its
//              discovery run deployed 614abcbe, which did not carry the roster bump;
//              the next run, on the bump commit, was green.
//   4 foreign  published from another repo; the daily catch-up (F038.44) names it
//
// No timer, no retry, no grace period: only a publish run counts as evidence.
export const OK = 0, STALE = 1, PENDING = 3, FOREIGN = 4;

/** The release tag publish.yml runs on: `<short name>-v<version>`. */
export const releaseTag = (pkg, version) => `${pkg.replace(/^@broberg\//, "")}-v${version}`;

/**
 * @param {{ card: {pkg:string,version:string}, newest: {pkg:string,version:string},
 *   own: Set<string>, publishRuns?: Array<{status:string,updated_at:string,html_url?:string}>,
 *   laterRuns?: Array<{id?:number,html_url?:string,event?:string,created_at:string}>,
 *   runStartedAt?: string, githubError?: string }} i
 * @returns {{ code: number, message: string }}
 */
export function featuredVerdict({ card, newest, own, publishRuns, laterRuns, runStartedAt, githubError }) {
  const named = `${newest.pkg}@${newest.version}`;
  if (card.pkg === newest.pkg && card.version === newest.version) return { code: OK, message: `names the newest release: ${named}` };
  if (!own.has(newest.pkg)) {
    return { code: FOREIGN, message: `${named} was published from another repo — the card refreshes on the next deploy (daily catch-up, F038.44). Not a failure (F038.48).` };
  }
  if (githubError || !runStartedAt || !publishRuns || !laterRuns) {
    return { code: STALE, message: `could not ask GitHub whether ${releaseTag(newest.pkg, newest.version)} is still publishing (${githubError ?? "no run data"}) — treated as STALE, not pending: an unanswered question is not evidence.` };
  }
  const started = Date.parse(runStartedAt);
  const live = publishRuns.find((r) => r.status !== "completed" || Date.parse(r.updated_at) > started);
  const later = laterRuns[0];
  if (later) {
    return { code: PENDING, message: `PENDING: a later discovery run (${later.html_url ?? later.id}, ${later.event ?? "?"}, created ${later.created_at}) deploys a newer commit and checks the card again — this run's answer is superseded. Newest: ${named}.` };
  }
  if (live) {
    return { code: PENDING, message: `PENDING: ${named} is still being released (publish run ${live.html_url ?? "?"} ${live.status === "completed" ? `finished ${live.updated_at}, after this run started ${runStartedAt}` : live.status}) — its own discovery run checks the card.` };
  }
  return { code: STALE, message: `${named} was released before this run started and the card still names ${card.pkg}@${card.version}.` };
}
