import { describe, expect, it } from "vitest";

// F039 enroll store: in-memory libSQL for tests (the lazy store reads this at
// first use, so setting it at module scope is enough). Auth is per-session
// trust-on-first-use — no central key env.
process.env.ENROLL_DB_URL = ":memory:";

import { app } from "./server";
import { getEnrollStore } from "./enroll";
import { SESSION_ALIASES } from "../../scripts/inventory-data.mjs";

describe("Discovery API", () => {
  it("GET /health → ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("GET /api/components?q=mail → finds @broberg/mail", async () => {
    const res = await app.request("/api/components?q=mail");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThan(0);
    const mail = body.components.find((c: { package: string }) => c.package === "@broberg/mail");
    expect(mail).toBeTruthy();
    expect(mail.status).toBe("shipped");
    expect(mail.id).toBe("F005");
  });

  it("ranks an exact name/package match above a description-only hit (q=lens → lens first, not mail)", async () => {
    const pkgs = (await (await app.request("/api/packages?q=lens")).json()).packages;
    expect(pkgs[0].name).toBe("@broberg/lens");
    const comps = (await (await app.request("/api/components?q=lens")).json()).components;
    expect(comps[0].package).toBe("@broberg/lens");
  });

  it("Trail is a searchable capability (q=memory/rag/second-brain surfaces it)", async () => {
    for (const q of ["memory", "rag", "second-brain"]) {
      const comps = (await (await app.request(`/api/search?q=${q}`)).json()).components;
      expect(comps.some((c: { id: string }) => c.id === "trail")).toBe(true);
    }
  });

  it("GET /api/components?status=shipped&layer=L0 filters", async () => {
    const res = await app.request("/api/components?status=shipped&layer=L0");
    const body = await res.json();
    expect(body.components.every((c: { status: string; layer: string }) => c.status === "shipped" && c.layer === "L0")).toBe(true);
    expect(body.components.some((c: { package: string }) => c.package === "@broberg/theme")).toBe(true);
  });

  it("GET /api/components/:id resolves a slug and 404s otherwise", async () => {
    const ok = await app.request("/api/components/seti-server");
    expect(ok.status).toBe(200);
    expect((await ok.json()).package).toBe("@broberg/seti-server");
    const miss = await app.request("/api/components/nope");
    expect(miss.status).toBe(404);
  });

  it("GET /api/packages → shipped npms with versions", async () => {
    const res = await app.request("/api/packages");
    const body = await res.json();
    const mail = body.packages.find((p: { name: string }) => p.name === "@broberg/mail");
    expect(mail.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.packages.every((p: { version: string | null }) => p.version)).toBe(true);
  });

  // F083 — this used to assert "the roster includes fdaa", which is a fact about
  // a hand-typed array rather than about the fleet. It passed for three months
  // while the same endpoint served 15 of 149 real dependencies.
  it("GET /api/fleet → rows come from the SCANNED manifests, and carry their own freshness", async () => {
    const res = await app.request("/api/fleet");
    const body = await res.json();

    // The property that matters: a repo nobody hand-wrote a row for is present,
    // with its real dependency list. contentpush has 10 and had no row at all.
    const cp = body.fleet.find((f: { s: string }) => f.s === "contentpush");
    expect(cp).toBeTruthy();
    expect(cp.uses.length).toBeGreaterThan(5);

    // And a caller can tell a current roster from a dead job without asking us.
    expect(typeof body.stale).toBe("boolean");
    expect(body.scanned_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.edges).toBeGreaterThan(100);
    expect(body.count).toBeGreaterThan(20);
  });

  it("GET /api/fleet → hand-written role text survives the derivation", async () => {
    const res = await app.request("/api/fleet");
    const body = await res.json();
    const cardmem = body.fleet.find((f: { s: string }) => f.s === "cardmem");
    // npm can prove a dependency exists; it cannot say what a repo is FOR.
    expect(cardmem.r).toContain("PM board");
    expect(cardmem.uses.length).toBeGreaterThan(10);
  });

  it("GET /api/search?q=lens → spans components + fleet", async () => {
    const res = await app.request("/api/search?q=lens");
    const body = await res.json();
    expect(body.components.some((c: { package: string }) => c.package === "@broberg/lens")).toBe(true);
    expect(body.fleet.length).toBeGreaterThan(0);
  });

  it("GET /api/search with no q → 400", async () => {
    expect((await app.request("/api/search")).status).toBe(400);
  });

  it("GET /api/stats → totals", async () => {
    const res = await app.request("/api/stats");
    const body = await res.json();
    expect(body.components).toBeGreaterThan(40);
    expect(body.shipped).toBeGreaterThanOrEqual(11);
  });

  it("GET / → serves the dashboard landing page (HTML)", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Component Universe");
  });

  it("GET / with Accept: application/json → the self-describing manifest", async () => {
    const res = await app.request("/", { headers: { accept: "application/json" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe("discovery.broberg.ai");
    expect(Array.isArray(body.endpoints)).toBe(true);
    // the root must hand the caller the searchable vocabulary
    expect(body.vocabularies.statuses).toContain("shipped");
    expect(body.vocabularies.infra.some((i: { id: string }) => i.id === "fly")).toBe(true);
    expect(body.vocabularies.layers.length).toBeGreaterThan(0);
  });

  it("GET /api → manifest lists every endpoint + vocabularies", async () => {
    const body = await (await app.request("/api")).json();
    const paths = body.endpoints.map((e: { path: string }) => e.path);
    expect(paths).toContain("/api/infra");
    expect(paths).toContain("/api/search");
    expect(paths).toContain("/llms.txt"); // F060 onboarding surface advertised
    expect(body.stats.infraPlatforms).toBeGreaterThanOrEqual(9);
  });

  it("GET /llms.txt → the markdown AI onboarding map (F060)", async () => {
    const res = await app.request("/llms.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("# broberg.ai shared inventory");
    expect(text).toContain("## Packages by category");
    expect(text).toContain("reuse before you build");
  });

  it("GET /onboarding → human page; /ai + /llms-full.txt resolve (F060)", async () => {
    expect((await app.request("/onboarding")).status).toBe(200);
    expect((await app.request("/ai")).status).toBe(200);
    const full = await app.request("/llms-full.txt");
    expect(full.status).toBe(200);
    expect(await full.text()).toContain("every tip inline");
  });

  it("GET /api/infra → platforms incl. fly with tipCount", async () => {
    const body = await (await app.request("/api/infra")).json();
    const fly = body.infra.find((p: { id: string }) => p.id === "fly");
    expect(fly).toBeTruthy();
    expect(fly.tipCount).toBeGreaterThan(0);
    expect(fly.tips).toBeUndefined(); // summary list omits the long tips
  });

  it("GET /api/infra/:id → full tips + notes, 404 otherwise", async () => {
    const fly = await (await app.request("/api/infra/fly")).json();
    expect(fly.region).toContain("arn");
    expect(fly.tips.length).toBeGreaterThan(0);
    expect(fly.notes).toBeTruthy();
    expect((await app.request("/api/infra/nope")).status).toBe(404);
  });

  it("GET /api/search?q=deploy → spans infra too", async () => {
    const body = await (await app.request("/api/search?q=deploy")).json();
    expect(body.infra.some((p: { id: string }) => p.id === "fly")).toBe(true);
  });

  it("tokenizes natural phrases — q='send email' surfaces @broberg/mail (Trail's gap)", async () => {
    const comps = (await (await app.request("/api/components?q=send%20email")).json()).components;
    expect(comps.some((c: { package: string }) => c.package === "@broberg/mail")).toBe(true);
    const search = await (await app.request("/api/search?q=send%20email")).json();
    expect(search.components.some((c: { package: string }) => c.package === "@broberg/mail")).toBe(true);
  });

  it("aliases resolve synonyms — 'dark mode' → theme, 'screenshot' → lens, 'authentication' → oauth", async () => {
    const theme = (await (await app.request("/api/components?q=dark%20mode")).json()).components;
    expect(theme.some((c: { package: string }) => c.package === "@broberg/theme")).toBe(true);
    const lens = (await (await app.request("/api/components?q=screenshot")).json()).components;
    expect(lens.some((c: { package: string }) => c.package === "@broberg/lens")).toBe(true);
    const oauth = (await (await app.request("/api/components?q=authentication")).json()).components;
    expect(oauth.some((c: { package: string }) => c.package === "@broberg/auth")).toBe(true);
  });

  it("infra aliases — 'postgres' → supabase, 'hosting' → fly", async () => {
    const s = await (await app.request("/api/search?q=postgres")).json();
    expect(s.infra.some((p: { id: string }) => p.id === "supabase")).toBe(true);
    const infra = (await (await app.request("/api/infra?q=hosting")).json()).infra;
    expect(infra.some((p: { id: string }) => p.id === "fly")).toBe(true);
  });

  it("infra search is noise-free — a stray token can't substring-hit long-form notes ('dark' ≠ 'ship-dark')", async () => {
    const body = await (await app.request("/api/search?q=dark%20mode")).json();
    // theme still wins the component result …
    expect(body.components.some((c: { package: string }) => c.package === "@broberg/theme")).toBe(true);
    // … but no infra platform should be dragged in via 'ship-dark'/'sends' substrings
    expect(body.infra.length).toBe(0);
  });

  // F038.5 — measured live 2026-08-10: adding a word REMOVED results. Tip text was
  // reachable only as a verbatim, in-order phrase, so `fastly negative-cache` found
  // the npm group and `negative-cache fastly` found nothing. Silence from this
  // endpoint is read fleet-wide as "we don't have that", and the next thing that
  // happens is a repo hand-rolls a duplicate.
  const infraIds = async (q: string) => {
    const body = await (await app.request(`/api/search?q=${encodeURIComponent(q)}`)).json();
    return (body.infra as { id: string }[]).map((p) => p.id);
  };

  it("a multi-word query reaches TIP TEXT regardless of word order", async () => {
    expect(await infraIds("fastly")).toContain("npm"); // 1 token: already worked
    expect(await infraIds("fastly negative-cache")).toContain("npm"); // verbatim: already worked
    expect(await infraIds("negative-cache fastly")).toContain("npm"); // SAME WORDS, reordered
  });

  it("all tokens must land in ONE segment — a tip, the notes, or the curated fields", async () => {
    expect(await infraIds("caret minor")).toContain("npm"); // both in the semver-0x tip
    expect(await infraIds("oidc caret")).toContain("npm"); // both in the curated kw list

    // The case that forced the per-segment rule, caught by the 'dark' ≠ 'ship-dark'
    // guard below: matching AND across a whole group let "dark" (from "ship-dark"
    // in one platform's notes) pair with "mode" (from "preview-mode" in an
    // unrelated email tip) and drag Resend into a search for dark mode. Two words
    // in two different sentences are a coincidence, not a topic.
    expect(await infraIds("dark mode")).not.toContain("resend");
  });

  it("precision holds — every token must be present, as a WORD", async () => {
    // A group with only ONE of the two words must not match on that alone …
    expect(await infraIds("fastly kubernetes")).not.toContain("npm");
    // … and a token must not substring-hit a longer word (the 'dark' ≠ 'ship-dark'
    // rule above, restated for the multi-token path).
    expect(await infraIds("cach fastl")).not.toContain("npm");
  });

  it("exposes keywords/aliases on components for discoverability", async () => {
    const mail = await (await app.request("/api/components/F005")).json();
    expect(Array.isArray(mail.keywords)).toBe(true);
    expect(mail.keywords).toContain("email");
  });

  it("components carry npm + PUBLIC-repo links; a private repo gets npmUrl but no repoUrl", async () => {
    const apikey = await (await app.request("/api/components/F010")).json();
    expect(apikey.npmUrl).toBe("https://www.npmjs.com/package/@broberg/apikey");
    expect(apikey.repoUrl).toBe("https://github.com/broberg-ai/components");
    // @broberg/complimenta-sdk is published (public on npm) but its repo (broberg-ai/fdaa) is PRIVATE → no repo link (would 404)
    const comp = await (await app.request("/api/components/complimenta-sdk")).json();
    expect(comp.npmUrl).toBe("https://www.npmjs.com/package/@broberg/complimenta-sdk");
    expect(comp.repoUrl).toBeNull();
    // /api/packages carries the links too
    const pkgs = (await (await app.request("/api/packages")).json()).packages;
    expect(pkgs.find((p: { name: string }) => p.name === "@broberg/apikey").npmUrl).toBeTruthy();
  });
});

describe("auto-enrollment (F039) — trust-on-first-use keys", () => {
  // Each session brings its OWN ≥32-char key (openssl rand -hex 32). TOFU binds
  // it on first contact. Distinct session names per test keep the shared
  // in-memory store from coupling tests.
  const KEY = "a".repeat(64);
  const KEY2 = "b".repeat(64);
  const enroll = (body: object, key: string | null = KEY) =>
    app.request("/api/enroll", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "x-enroll-key": key } : {}) },
      body: JSON.stringify(body),
    });

  it("missing or too-short key → 401", async () => {
    expect((await enroll({ session: "t-nokey", pkg: "@broberg/mail", version: "0.1.0" }, null)).status).toBe(401);
    expect((await enroll({ session: "t-short", pkg: "@broberg/mail", version: "0.1.0" }, "short")).status).toBe(401);
  });

  it("unknown package → 400 (rejected before any key is bound)", async () => {
    expect((await enroll({ session: "t-unknown", pkg: "@broberg/nope", version: "1.0.0" })).status).toBe(400);
  });

  it("first enroll binds the session's key (TOFU) + shows in roster/status, excluded from gap", async () => {
    const res = await enroll({ session: "trail-test", pkg: "@broberg/mail", version: "0.1.0", role: "uses", commit: "f776213" });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.key).toBe("registered");
    expect(j.enrollment.pkg).toBe("@broberg/mail");

    const roster = await (await app.request("/api/enrollments")).json();
    expect(roster.enrollments.some((e: { session: string; pkg: string }) => e.session === "trail-test" && e.pkg === "@broberg/mail")).toBe(true);

    const status = await (await app.request("/api/sessions/trail-test")).json();
    expect(status.enrolled.some((e: { pkg: string }) => e.pkg === "@broberg/mail")).toBe(true);
    expect(status.gap.some((g: { package: string }) => g.package === "@broberg/mail")).toBe(false);
    expect(status.gap.length).toBeGreaterThan(0);
  });

  it("same session + same key → matched, idempotent (no duplicate row)", async () => {
    const res = await enroll({ session: "trail-test", pkg: "@broberg/mail", version: "0.2.0" });
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe("matched");
    const roster = await (await app.request("/api/enrollments")).json();
    const rows = roster.enrollments.filter((e: { session: string; pkg: string }) => e.session === "trail-test" && e.pkg === "@broberg/mail");
    expect(rows.length).toBe(1);
    expect(rows[0].version).toBe("0.2.0");
  });

  it("same session + a DIFFERENT key → 401 mismatch (can't hijack a bound session)", async () => {
    const res = await enroll({ session: "trail-test", pkg: "@broberg/lens", version: "0.1.2" }, KEY2);
    expect(res.status).toBe(401);
  });

  it("a different session binds its own key independently", async () => {
    const res = await enroll({ session: "other-test", pkg: "@broberg/config", version: "0.1.1" }, KEY2);
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe("registered");
  });

  it("the manifest advertises the enroll endpoints", async () => {
    const paths = (await (await app.request("/api")).json()).endpoints.map((e: { path: string }) => e.path);
    expect(paths).toContain("/api/enroll");
    expect(paths).toContain("/api/enrollments");
    expect(paths).toContain("/api/sessions/:session");
  });

  it("resetSessionKey clears ONLY the key binding — enrollments survive, session re-binds a fresh key (F039.5)", async () => {
    const sess = "reset-test";
    // Bind KEY + record an enrollment for this session.
    expect((await enroll({ session: sess, pkg: "@broberg/mail", version: "0.1.0" }, KEY)).status).toBe(200);
    // While bound, a DIFFERENT key is rejected (the lock-out fd-sundhed hit).
    expect((await enroll({ session: sess, pkg: "@broberg/lens", version: "0.1.0" }, KEY2)).status).toBe(401);

    const store = await getEnrollStore();
    expect(store).not.toBeNull();
    // Reset drops exactly one row (the binding) — RED without resetSessionKey.
    expect(await store!.resetSessionKey(sess)).toBe(1);
    expect(await store!.sessionKeyHash(sess)).toBeNull();

    // The enrollments (adoptions) live in a separate table and MUST survive.
    const roster = await (await app.request("/api/enrollments")).json();
    expect(roster.enrollments.some((e: { session: string; pkg: string }) => e.session === sess && e.pkg === "@broberg/mail")).toBe(true);

    // Now the session can re-bind with its FRESH key and enroll again.
    const re = await enroll({ session: sess, pkg: "@broberg/lens", version: "0.1.0" }, KEY2);
    expect(re.status).toBe(200);
    expect((await re.json()).key).toBe("registered");

    // Resetting an unbound session is a safe no-op (0 rows) — never throws.
    expect(await store!.resetSessionKey("never-bound-session")).toBe(0);
  });

  // ── F039.7 ────────────────────────────────────────────────────────────────
  // The gap is a session's REUSE TO-DO — cardmem_session_start serves it at boot
  // — so a wrong one tells a working session to build something it already has.

  it("a session that has NEVER self-reported is labelled as such, not handed a to-do list", async () => {
    const s = await (await app.request("/api/sessions/never-said-anything")).json();
    expect(s.enrolled).toEqual([]);
    expect(s.gap_confidence).toBe("never_reported");
    // and it still returns the list — the claim is about its CONFIDENCE, never
    // about whether a package is genuinely unused, which the server cannot know.
    expect(s.gap.length).toBeGreaterThan(0);
  });

  it("...and the WORDS warn, not just the flag — separately, because the flag is not what a human reads", async () => {
    // Split from the test above on purpose. While they were one test, dropping
    // the warning and dropping the flag produced the SAME failure, so no test
    // pinned the note on its own — caught by the mutation pass, not by review.
    const s = await (await app.request("/api/sessions/never-said-anything")).json();
    expect(s.gap_note).toContain("UNVERIFIED");
    expect(s.gap_note).toContain("never self-reported");
    expect(s.gap_note).toContain("NOT as a to-do list");
  });

  it("...and a session WITH an enrollment is labelled self_reported — both branches, not just the empty one", async () => {
    const s = await (await app.request("/api/sessions/trail-test")).json();
    expect(s.enrolled.length).toBeGreaterThan(0);
    expect(s.gap_confidence).toBe("self_reported");
    expect(s.gap_note).toContain("Self-reported");
    expect(s.gap_note).not.toContain("UNVERIFIED");
  });

  it("an aliased identity's enrollments count for the repo, and the merge is DISCLOSED", async () => {
    // A real case: this session enrolled under its raw session-UUID instead of
    // its repo name, so the row was invisible to the repo forever. Resolved by
    // buddy from two independent sources, 2026-09-01.
    const UUID = "2e155461-2619-43c2-9056-2ce1184ad5ad";
    expect((await enroll({ session: UUID, pkg: "@broberg/bodymap", version: "0.1.1" }, "c".repeat(64))).status).toBe(200);

    const s = await (await app.request("/api/sessions/fd-sundhed")).json();
    expect(s.resolved_session).toBe("fd-sundhed");
    // The point of the whole card: the package is no longer in the to-do list.
    expect(s.enrolled.some((e: { pkg: string }) => e.pkg === "@broberg/bodymap")).toBe(true);
    expect(s.gap.some((g: { package: string }) => g.package === "@broberg/bodymap")).toBe(false);
  });

  it("...and the merge is DISCLOSED — separately, so silence and absence are different failures", async () => {
    // Also split after the mutation pass: while disclosure lived in the test
    // above, "the union is dropped" and "the disclosure is dropped" reddened the
    // same single test, so neither was pinned alone. A silently merged answer is
    // a new way to be confidently wrong, and it deserves its own red.
    const s = await (await app.request("/api/sessions/fd-sundhed")).json();
    expect(s.merged_from).toContain("2e155461-2619-43c2-9056-2ce1184ad5ad");
  });

  it("NEGATIVE CONTROL: a session not in the alias map is untouched", async () => {
    // Without this the merge could apply to everything and the test above would
    // still pass.
    const s = await (await app.request("/api/sessions/other-test")).json();
    expect(s.resolved_session).toBe("other-test");
    expect(s.merged_from).toEqual([]);
    expect(s.enrolled.some((e: { pkg: string }) => e.pkg === "@broberg/bodymap")).toBe(false);
  });

  it("the alias map contains only MEASURED entries — no name-similarity merges", async () => {
    // The first draft mapped `fds` -> `fd-sundhed` because the names look alike.
    // buddy measured it: `fds` is fysiodk-aalborg-sport, a different customer.
    // The FLEET roster in this very repo says so (`fds` -> sport.fdaalborg.dk).
    //
    // A SPLIT identity makes a gap look too long, which is visible. A FALSE
    // MERGE makes it look right while crediting one customer's adoptions to
    // another. This asserts the dangerous direction stays closed.
    expect(Object.keys(SESSION_ALIASES)).not.toContain("fds");
    // The ONE non-UUID alias is owner-confirmed: Christian, 2026-09-01,
    // "sanne + sanneandersen er samme repo". Held back until he said so.
    const OWNER_CONFIRMED = new Set(["sanneandersen"]);
    for (const [from, to] of Object.entries(SESSION_ALIASES as Record<string, string>)) {
      expect(from).not.toBe(to);
      // A raw session-UUID is self-evidently one identity. Anything else is a
      // NAME, and a name that looks like another name is not evidence — so it
      // has to be listed above, which is where that decision gets noticed.
      const isUuid = /^[0-9a-f-]{36}$/.test(from);
      expect(isUuid || OWNER_CONFIRMED.has(from)).toBe(true);
    }
  });

  it("a session's own published packages are excluded from its gap (ai-sdk #5335)", async () => {
    const owner = await (await app.request("/api/sessions/ai-sdk")).json();
    expect(owner.owns).toContain("@broberg/ai-sdk");
    expect(owner.gap.some((g: { package: string }) => g.package === "@broberg/ai-sdk")).toBe(false);
    // a non-owning session still sees that package in its gap
    const other = await (await app.request("/api/sessions/nobody-owns-this")).json();
    expect(other.owns).toEqual([]);
    expect(other.gap.some((g: { package: string }) => g.package === "@broberg/ai-sdk")).toBe(true);
  });
});
