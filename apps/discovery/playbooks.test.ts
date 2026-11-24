// F038.50 — Playbooks: submit with a registered key, own your slug, render safely,
// and be found by /api/search and the llms files.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

process.env.ENROLL_DB_URL = "file::memory:?cache=shared";
const { app } = await import("./server");
const { getEnrollStore } = await import("./enroll");
const { renderMarkdown, validatePlaybook } = await import("./playbooks");

const sha = (k: string) => createHash("sha256").update(k).digest("hex");
const A = "pb-author-a", A_KEY = "a".repeat(64);
const B = "pb-author-b", B_KEY = "b".repeat(64);
const register = async () => {
  const s = (await getEnrollStore())!;
  await s.bindSessionKey(A, sha(A_KEY));
  await s.bindSessionKey(B, sha(B_KEY));
};
const as = (session: string, key: string) => ({ "x-discovery-session": session, "x-enroll-key": key });
const post = async (session: string, key: string, body: unknown) => {
  await register();
  return app.request("/api/playbooks", { method: "POST", headers: { ...as(session, key), "content-type": "application/json" }, body: JSON.stringify(body) });
};
const get = async (path: string) => { await register(); return app.request(path, { headers: as(A, A_KEY) }); };

const STRIPE = {
  slug: "stripe-connect-direct-charges",
  title: "Stripe Connect — direct charges fra første betaling",
  summary: "Sæt en kunde op så Stripes gebyr trækkes hos kunden, ikke hos platformen.",
  kw: ["stripe", "connect", "direct charges", "gebyr"],
  repo: "webhousecode/sanneandersen",
  body: "# Stripe Connect\n\nBrug **direct charges** og `application_fee_amount`.\n\n| Dato | Hvad |\n|---|---|\n| 25/8 | Stripe advarer |\n",
};

describe("POST /api/playbooks", () => {
  it("a registered session creates (201), then updates its own playbook (200, revision 2)", async () => {
    const r1 = await post(A, A_KEY, STRIPE);
    expect(r1.status).toBe(201);
    const r2 = await post(A, A_KEY, { ...STRIPE, summary: "Opdateret." });
    expect(r2.status).toBe(200);
    const j = await (await get(`/api/playbooks/${STRIPE.slug}`)).json() as { summary: string; revision: number; owner: string; body: string };
    expect([j.summary, j.revision, j.owner]).toEqual(["Opdateret.", 2, A]);
    expect(j.body).toBe(STRIPE.body);
  });

  it("another session cannot overwrite it (403), and the text is unchanged", async () => {
    await post(A, A_KEY, STRIPE);
    const r = await post(B, B_KEY, { ...STRIPE, body: "# hijacked" });
    expect(r.status).toBe(403);
    const j = await (await get(`/api/playbooks/${STRIPE.slug}`)).json() as { body: string; owner: string };
    expect([j.owner, j.body]).toEqual([A, STRIPE.body]);
  });

  it("unknown session or wrong key → 401", async () => {
    expect((await post("pb-nobody", "n".repeat(64), STRIPE)).status).toBe(401);
    expect((await post(A, "z".repeat(64), STRIPE)).status).toBe(401);
  });

  it("bad slug, missing title, oversize body, bad repo → 400", async () => {
    expect((await post(A, A_KEY, { ...STRIPE, slug: "Bad Slug" })).status).toBe(400);
    expect((await post(A, A_KEY, { ...STRIPE, title: "" })).status).toBe(400);
    expect((await post(A, A_KEY, { ...STRIPE, slug: "too-big", body: "x".repeat(200_001) })).status).toBe(400);
    expect((await post(A, A_KEY, { ...STRIPE, repo: "not a repo" })).status).toBe(400);
    expect(validatePlaybook({ ...STRIPE, slug: "fine-slug", body: "x".repeat(200_000) }).ok).toBe(true);
  });
});

describe("reading", () => {
  it("/playbooks lists it and /playbooks/:slug renders the markdown (table, bold, code)", async () => {
    await post(A, A_KEY, STRIPE);
    const list = await (await get("/playbooks")).text();
    expect(list).toContain(`data-testid="playbooks-link-${STRIPE.slug}"`);
    const page = await get(`/playbooks/${STRIPE.slug}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<strong>direct charges</strong>");
    expect(html).toContain("<code>application_fee_amount</code>");
    expect(html).toContain("<td>Stripe advarer</td>");
    expect((await get("/playbooks/does-not-exist")).status).toBe(404);
  });

  it("untrusted markdown cannot inject markup or a script link", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[klik](javascript:alert(3)) [ok](https://example.com/a?b=1&c=2)\n\n`<b>kode</b>`');
    expect(html).not.toMatch(/<script|<img|href="javascript/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;");
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ok</a>');
    expect(html).toContain("<code>&lt;b&gt;kode&lt;/b&gt;</code>");
  });
});

describe("found like everything else", () => {
  it("/api/search returns it under «playbooks»", async () => {
    await post(A, A_KEY, STRIPE);
    const j = await (await get("/api/search?q=stripe%20connect")).json() as { playbooks: { slug: string; url: string }[] };
    expect(j.playbooks.map((p) => p.slug)).toContain(STRIPE.slug);
    const none = await (await get("/api/search?q=zzqqxx-nothing")).json() as { playbooks: unknown[] };
    expect(none.playbooks).toEqual([]);
  });

  it("/llms.txt and /ai list title + address; /llms-full.txt carries the whole text", async () => {
    await post(A, A_KEY, STRIPE);
    const url = `https://discovery.broberg.ai/playbooks/${STRIPE.slug}`;
    for (const p of ["/llms.txt", "/ai"]) expect(await (await get(p)).text()).toContain(`](${url})`);
    expect(await (await get("/llms-full.txt")).text()).toContain("| 25/8 | Stripe advarer |");
  });
});
