import { describe, expect, it } from "vitest";

// F039 enroll store: in-memory libSQL for tests (the lazy store reads this at
// first use, so setting it at module scope is enough). Auth is per-session
// trust-on-first-use — no central key env.
process.env.ENROLL_DB_URL = ":memory:";

import { app } from "./server";
import { getEnrollStore } from "./enroll";
import { DATA, SESSION_ALIASES } from "../../scripts/inventory-data.mjs";
import { createHash } from "node:crypto";

// F038.21/22 — sessions are REGISTERED by components (no trust-on-first-use), and
// the fleet part of Discovery needs a registered session's key to read.
const sha = (k: string) => createHash("sha256").update(k).digest("hex");
const register = async (session: string, key: string) => (await getEnrollStore())!.bindSessionKey(session, sha(key));
const READER = "test-reader";
const READER_KEY = "r".repeat(64);
const fleet = async (path: string) => {
  await register(READER, READER_KEY);
  return app.request(path, { headers: { "x-discovery-session": READER, "x-enroll-key": READER_KEY } });
};
// Christian 8/10: the WHOLE site is behind login, so every test request logs in.
const req = async (path: string, init: RequestInit = {}) => {
  await register(READER, READER_KEY);
  return app.request(path, { ...init, headers: { "x-discovery-session": READER, "x-enroll-key": READER_KEY, ...(init.headers as Record<string, string> | undefined) } });
};

describe("Discovery API", () => {
  it("F014.12: / and /onboarding carry the cookie banner, served from our own origin", async () => {
    for (const path of ["/", "/onboarding"]) {
      const html = await (await req(path)).text();
      expect(html).toContain('<broberg-consent policy-version="2026-09" lang="en" categories="" reopen-position="bottom-right"');
      // the token map is what makes the banner readable on Discovery's palette
      expect(html).toContain("--card-foreground:var(--fg);--primary-foreground:var(--primary-fg)");
      expect(html).toContain('<script type="module" src="/consent/element.js"></script>');
    }
    const js = await req("/consent/element.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(await js.text()).toContain("broberg-consent");
    expect((await req("/consent/..%2Fpackage.json")).status).toBe(404);
  });

  it("F038.25: / and /onboarding carry the SAME favicon, from one shared module", async () => {
    const { FAVICON_LINK } = await import("../../scripts/favicon.mjs");
    const icon = (html: string) => html.match(/<link rel="icon" href="[^"]+">/)?.[0] ?? null;
    const home = icon(await (await req("/", { headers: { accept: "text/html" } })).text());
    const onboarding = icon(await (await req("/onboarding")).text());
    expect(home).toBe(FAVICON_LINK);
    expect(onboarding).toBe(FAVICON_LINK);
  });

  it("GET /health → ok", async () => {
    const res = await req("/health");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("GET /api/components?q=mail → finds @broberg/mail", async () => {
    const res = await req("/api/components?q=mail");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThan(0);
    const mail = body.components.find((c: { package: string }) => c.package === "@broberg/mail");
    expect(mail).toBeTruthy();
    expect(mail.status).toBe("shipped");
    expect(mail.id).toBe("F005");
  });

  it("ranks an exact name/package match above a description-only hit (q=lens → lens first, not mail)", async () => {
    const pkgs = (await (await req("/api/packages?q=lens")).json()).packages;
    expect(pkgs[0].name).toBe("@broberg/lens");
    const comps = (await (await req("/api/components?q=lens")).json()).components;
    expect(comps[0].package).toBe("@broberg/lens");
  });

  it("Trail is a searchable capability (q=memory/rag/second-brain surfaces it)", async () => {
    for (const q of ["memory", "rag", "second-brain"]) {
      const comps = (await (await req(`/api/search?q=${q}`)).json()).components;
      expect(comps.some((c: { id: string }) => c.id === "trail")).toBe(true);
    }
  });

  it("GET /api/components?status=shipped&layer=L0 filters", async () => {
    const res = await req("/api/components?status=shipped&layer=L0");
    const body = await res.json();
    expect(body.components.every((c: { status: string; layer: string }) => c.status === "shipped" && c.layer === "L0")).toBe(true);
    expect(body.components.some((c: { package: string }) => c.package === "@broberg/theme")).toBe(true);
  });

  it("GET /api/components/:id resolves a slug and 404s otherwise", async () => {
    const ok = await req("/api/components/seti-server");
    expect(ok.status).toBe(200);
    expect((await ok.json()).package).toBe("@broberg/seti-server");
    const miss = await req("/api/components/nope");
    expect(miss.status).toBe(404);
  });

  it("GET /api/packages → shipped npms with versions", async () => {
    const res = await req("/api/packages");
    const body = await res.json();
    const mail = body.packages.find((p: { name: string }) => p.name === "@broberg/mail");
    expect(mail.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.packages.every((p: { version: string | null }) => p.version)).toBe(true);
  });

  // F083 — this used to assert "the roster includes fdaa", which is a fact about
  // a hand-typed array rather than about the fleet. It passed for three months
  // while the same endpoint served 15 of 149 real dependencies.
  it("GET /api/fleet → rows come from the SCANNED manifests, and carry their own freshness", async () => {
    const res = await fleet("/api/fleet");
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
    const res = await fleet("/api/fleet");
    const body = await res.json();
    const cardmem = body.fleet.find((f: { s: string }) => f.s === "cardmem");
    // npm can prove a dependency exists; it cannot say what a repo is FOR.
    expect(cardmem.r).toContain("PM board");
    expect(cardmem.uses.length).toBeGreaterThan(10);
  });

  it("GET /api/search?q=lens → spans components + fleet", async () => {
    const res = await req("/api/search?q=lens");
    const body = await res.json();
    expect(body.components.some((c: { package: string }) => c.package === "@broberg/lens")).toBe(true);
    expect(body.fleet.length).toBeGreaterThan(0);
  });

  it("GET /api/search with no q → 400", async () => {
    expect((await req("/api/search")).status).toBe(400);
  });

  it("GET /api/stats → totals", async () => {
    const res = await req("/api/stats");
    const body = await res.json();
    expect(body.components).toBeGreaterThan(40);
    expect(body.shipped).toBeGreaterThanOrEqual(11);
  });

  it("GET / → serves the dashboard landing page (HTML)", async () => {
    const res = await req("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Component Universe");
  });

  it("GET / with Accept: application/json → the self-describing manifest", async () => {
    const res = await req("/", { headers: { accept: "application/json" } });
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
    const body = await (await req("/api")).json();
    const paths = body.endpoints.map((e: { path: string }) => e.path);
    expect(paths).toContain("/api/infra");
    expect(paths).toContain("/api/search");
    expect(paths).toContain("/llms.txt"); // F060 onboarding surface advertised
    expect(body.stats.infraPlatforms).toBeGreaterThanOrEqual(9);
  });

  it("GET /llms.txt → the markdown AI onboarding map (F060)", async () => {
    const res = await req("/llms.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("# broberg.ai shared inventory");
    expect(text).toContain("## Packages by category");
    expect(text).toContain("reuse before you build");
  });

  it("GET /onboarding → human page; /ai + /llms-full.txt resolve (F060)", async () => {
    expect((await req("/onboarding")).status).toBe(200);
    expect((await req("/ai")).status).toBe(200);
    expect((await fleet("/llms-full.txt")).status).toBe(200);
  });

  // F038.15 — /llms-full.txt served a BYTE-IDENTICAL copy of /llms.txt for
  // months. The assertion that used to stand here was `toContain("every tip
  // inline")`, and that phrase is in BOTH files — so it passed happily on the
  // aliased version. It is the exact shape this repo keeps finding: a check that
  // answers a narrower question than the one it is used for.
  //
  // What it asserts now is what the name promises: the COMPLETE description,
  // taken from the single source at test time rather than a quoted sentence that
  // rots the next time someone edits a roster row.
  it("GET /llms-full.txt → the complete descriptions, and /llms.txt the one-liners (F038.15)", async () => {
    const short = await (await req("/llms.txt")).text();
    const full = await (await fleet("/llms-full.txt")).text();
    expect(full).not.toBe(short);

    const descs = (DATA as { items?: { pkg?: string; desc?: string }[] }[])
      .flatMap((L) => L.items ?? [])
      .filter((p) => p.pkg && p.desc)
      .map((p) => ({ pkg: p.pkg!, desc: p.desc!.replace(/\s+/g, " ").trim() }));
    expect(descs.length).toBeGreaterThan(10);

    // EVERY row, not a sample: remove the truncation from one renderer only and
    // the two files differ while the full one is still cut.
    const missing = descs.filter((d) => !full.includes(d.desc));
    expect(missing.map((d) => d.pkg)).toEqual([]);

    // …and the map did not become a second copy of the full text.
    const longest = descs.reduce((a, b) => (b.desc.length > a.desc.length ? b : a));
    expect(longest.desc.length).toBeGreaterThan(1000);
    expect(short.includes(longest.desc)).toBe(false);
  });

  it("GET /api/infra → platforms incl. fly with tipCount", async () => {
    const body = await (await req("/api/infra")).json();
    const fly = body.infra.find((p: { id: string }) => p.id === "fly");
    expect(fly).toBeTruthy();
    expect(fly.tipCount).toBeGreaterThan(0);
    expect(fly.tips).toBeUndefined(); // summary list omits the long tips
  });

  it("GET /api/infra/:id → full tips + notes, 404 otherwise", async () => {
    const fly = await (await req("/api/infra/fly")).json();
    expect(fly.region).toContain("arn");
    expect(fly.tips.length).toBeGreaterThan(0);
    expect(fly.notes).toBeTruthy();
    expect((await req("/api/infra/nope")).status).toBe(404);
  });

  it("GET /api/search?q=deploy → spans infra too", async () => {
    const body = await (await req("/api/search?q=deploy")).json();
    expect(body.infra.some((p: { id: string }) => p.id === "fly")).toBe(true);
  });

  it("tokenizes natural phrases — q='send email' surfaces @broberg/mail (Trail's gap)", async () => {
    const comps = (await (await req("/api/components?q=send%20email")).json()).components;
    expect(comps.some((c: { package: string }) => c.package === "@broberg/mail")).toBe(true);
    const search = await (await req("/api/search?q=send%20email")).json();
    expect(search.components.some((c: { package: string }) => c.package === "@broberg/mail")).toBe(true);
  });

  it("aliases resolve synonyms — 'dark mode' → theme, 'screenshot' → lens, 'authentication' → oauth", async () => {
    const theme = (await (await req("/api/components?q=dark%20mode")).json()).components;
    expect(theme.some((c: { package: string }) => c.package === "@broberg/theme")).toBe(true);
    const lens = (await (await req("/api/components?q=screenshot")).json()).components;
    expect(lens.some((c: { package: string }) => c.package === "@broberg/lens")).toBe(true);
    const oauth = (await (await req("/api/components?q=authentication")).json()).components;
    expect(oauth.some((c: { package: string }) => c.package === "@broberg/auth")).toBe(true);
  });

  it("infra aliases — 'postgres' → supabase, 'hosting' → fly", async () => {
    const s = await (await req("/api/search?q=postgres")).json();
    expect(s.infra.some((p: { id: string }) => p.id === "supabase")).toBe(true);
    const infra = (await (await req("/api/infra?q=hosting")).json()).infra;
    expect(infra.some((p: { id: string }) => p.id === "fly")).toBe(true);
  });

  it("infra search is noise-free — a stray token can't substring-hit long-form notes ('dark' ≠ 'ship-dark')", async () => {
    const body = await (await req("/api/search?q=dark%20mode")).json();
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
    const body = await (await req(`/api/search?q=${encodeURIComponent(q)}`)).json();
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
    const mail = await (await req("/api/components/F005")).json();
    expect(Array.isArray(mail.keywords)).toBe(true);
    expect(mail.keywords).toContain("email");
  });

  it("components carry npm + PUBLIC-repo links; a private repo gets npmUrl but no repoUrl", async () => {
    const apikey = await (await req("/api/components/F010")).json();
    expect(apikey.npmUrl).toBe("https://www.npmjs.com/package/@broberg/apikey");
    expect(apikey.repoUrl).toBe("https://github.com/broberg-ai/components");
    // @broberg/complimenta-sdk is published (public on npm) but its repo (broberg-ai/fdaa) is PRIVATE → no repo link (would 404)
    const comp = await (await req("/api/components/complimenta-sdk")).json();
    expect(comp.npmUrl).toBe("https://www.npmjs.com/package/@broberg/complimenta-sdk");
    expect(comp.repoUrl).toBeNull();
    // /api/packages carries the links too
    const pkgs = (await (await req("/api/packages")).json()).packages;
    expect(pkgs.find((p: { name: string }) => p.name === "@broberg/apikey").npmUrl).toBeTruthy();
  });
});

describe("auto-enrollment (F039) — registered sessions only (F038.21)", () => {
  // Each session brings its OWN ≥32-char key (openssl rand -hex 32). TOFU binds
  // it on first contact. Distinct session names per test keep the shared
  // in-memory store from coupling tests.
  const KEY = "a".repeat(64);
  const KEY2 = "b".repeat(64);
  const enroll = (body: object, key: string | null = KEY) =>
    req("/api/enroll", {
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

  it("an UNREGISTERED session is refused and nothing is bound — the trust-on-first-use hole is closed", async () => {
    const res = await enroll({ session: "stranger-test", pkg: "@broberg/mail", version: "0.1.0" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/^session_not_registered/);
    expect(await (await getEnrollStore())!.sessionKeyHash("stranger-test")).toBeNull();
    const roster = await (await fleet("/api/enrollments")).json();
    expect(roster.enrollments.some((e: { session: string }) => e.session === "stranger-test")).toBe(false);
  });

  it("a registered session enrolls + shows in roster/status, excluded from gap", async () => {
    await register("trail-test", KEY);
    await register("other-test", KEY2);
    await register("reset-test", KEY);
    await register("2e155461-2619-43c2-9056-2ce1184ad5ad", "c".repeat(64));
    const res = await enroll({ session: "trail-test", pkg: "@broberg/mail", version: "0.1.0", role: "uses", commit: "f776213" });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.key).toBe("matched");
    expect(j.enrollment.pkg).toBe("@broberg/mail");

    const roster = await (await fleet("/api/enrollments")).json();
    expect(roster.enrollments.some((e: { session: string; pkg: string }) => e.session === "trail-test" && e.pkg === "@broberg/mail")).toBe(true);

    const status = await (await fleet("/api/sessions/trail-test")).json();
    expect(status.enrolled.some((e: { pkg: string }) => e.pkg === "@broberg/mail")).toBe(true);
    expect(status.gap.some((g: { package: string }) => g.package === "@broberg/mail")).toBe(false);
    expect(status.gap.length).toBeGreaterThan(0);
  });

  it("same session + same key → matched, idempotent (no duplicate row)", async () => {
    const res = await enroll({ session: "trail-test", pkg: "@broberg/mail", version: "0.2.0" });
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe("matched");
    const roster = await (await fleet("/api/enrollments")).json();
    const rows = roster.enrollments.filter((e: { session: string; pkg: string }) => e.session === "trail-test" && e.pkg === "@broberg/mail");
    expect(rows.length).toBe(1);
    expect(rows[0].version).toBe("0.2.0");
  });

  it("same session + a DIFFERENT key → 401 mismatch (can't hijack a bound session)", async () => {
    const res = await enroll({ session: "trail-test", pkg: "@broberg/lens", version: "0.1.2" }, KEY2);
    expect(res.status).toBe(401);
  });

  it("a different registered session uses its own key independently", async () => {
    const res = await enroll({ session: "other-test", pkg: "@broberg/config", version: "0.1.1" }, KEY2);
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe("matched");
  });

  it("the manifest advertises the enroll endpoints", async () => {
    const paths = (await (await req("/api")).json()).endpoints.map((e: { path: string }) => e.path);
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
    const roster = await (await fleet("/api/enrollments")).json();
    expect(roster.enrollments.some((e: { session: string; pkg: string }) => e.session === sess && e.pkg === "@broberg/mail")).toBe(true);

    // After a reset the session is UNREGISTERED: it cannot re-bind itself
    // (F038.21) — components registers the fresh key, then it enrolls again.
    expect((await enroll({ session: sess, pkg: "@broberg/lens", version: "0.1.0" }, KEY2)).status).toBe(401);
    await register(sess, KEY2);
    const re = await enroll({ session: sess, pkg: "@broberg/lens", version: "0.1.0" }, KEY2);
    expect(re.status).toBe(200);
    expect((await re.json()).key).toBe("matched");

    // Resetting an unbound session is a safe no-op (0 rows) — never throws.
    expect(await store!.resetSessionKey("never-bound-session")).toBe(0);
  });

  // ── F039.7 ────────────────────────────────────────────────────────────────
  // The gap is a session's REUSE TO-DO — cardmem_session_start serves it at boot
  // — so a wrong one tells a working session to build something it already has.

  it("a session that has NEVER self-reported is labelled as such, not handed a to-do list", async () => {
    const s = await (await fleet("/api/sessions/never-said-anything")).json();
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
    const s = await (await fleet("/api/sessions/never-said-anything")).json();
    expect(s.gap_note).toContain("UNVERIFIED");
    expect(s.gap_note).toContain("never self-reported");
    expect(s.gap_note).toContain("NOT as a to-do list");
  });

  it("...and a session WITH an enrollment is labelled self_reported — both branches, not just the empty one", async () => {
    const s = await (await fleet("/api/sessions/trail-test")).json();
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

    const s = await (await fleet("/api/sessions/fd-sundhed")).json();
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
    const s = await (await fleet("/api/sessions/fd-sundhed")).json();
    expect(s.merged_from).toContain("2e155461-2619-43c2-9056-2ce1184ad5ad");
  });

  it("NEGATIVE CONTROL: a session not in the alias map is untouched", async () => {
    // Without this the merge could apply to everything and the test above would
    // still pass.
    const s = await (await fleet("/api/sessions/other-test")).json();
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
    const owner = await (await fleet("/api/sessions/ai-sdk")).json();
    expect(owner.owns).toContain("@broberg/ai-sdk");
    expect(owner.gap.some((g: { package: string }) => g.package === "@broberg/ai-sdk")).toBe(false);
    // a non-owning session still sees that package in its gap
    const other = await (await fleet("/api/sessions/nobody-owns-this")).json();
    expect(other.owns).toEqual([]);
    expect(other.gap.some((g: { package: string }) => g.package === "@broberg/ai-sdk")).toBe(true);
  });
});

describe("F038.22 / F038.24 — the fleet part needs a registered session and is noindex", () => {
  const PATHS = ["/api/fleet", "/api/enrollments", "/api/sessions/trail", "/llms-full.txt"];
  it("without a login every fleet path is 401 and noindex", async () => {
    for (const p of PATHS) {
      const res = await app.request(p);
      expect([p, res.status, res.headers.get("x-robots-tag")]).toEqual([p, 401, "noindex, nofollow"]);
    }
  });
  it("a WRONG key for a registered session is refused too", async () => {
    await register(READER, READER_KEY);
    const res = await app.request("/api/fleet", { headers: { "x-discovery-session": READER, "x-enroll-key": "z".repeat(64) } });
    expect(res.status).toBe(401);
  });
  it("with a registered session's key every fleet path answers 200, still noindex", async () => {
    for (const p of PATHS) {
      const res = await fleet(p);
      expect([p, res.status, res.headers.get("x-robots-tag")]).toEqual([p, 200, "noindex, nofollow"]);
    }
  });
  it("the WHOLE site is closed too (Christian: «bag BID NU») — only /health and /robots.txt answer without a login", async () => {
    for (const p of ["/", "/ai", "/llms.txt", "/onboarding", "/api", "/api/packages", "/api/components", "/api/search?q=mail", "/api/speech-dictionary"]) {
      const res = await app.request(p);
      expect([p, res.status, res.headers.get("x-robots-tag")]).toEqual([p, 401, "noindex, nofollow"]);
    }
    expect((await app.request("/health")).status).toBe(200);
  });
  it("robots.txt disallows everything", async () => {
    expect(await (await app.request("/robots.txt")).text()).toBe("User-agent: *\nDisallow: /\n");
  });
});
