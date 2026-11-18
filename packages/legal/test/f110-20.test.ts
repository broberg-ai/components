// F110.20 — the filled DPA a customer accepts in BID (cardmem #51537, F422.2).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EXAMPLE_FACTS, PLACEHOLDERS, fillPlaceholders, getDocument, recordAcceptance, renderText, textHash, type Placeholder } from "../src/index";

const VALUES = Object.fromEntries(PLACEHOLDERS.map((p) => [p, `«${p}» Ærø Ølstykke Å/S`])) as Record<Placeholder, string>;
const dpa = () => getDocument({ doc: "dpa", locale: "da", facts: EXAMPLE_FACTS });

describe("fillPlaceholders", () => {
  it("the dpa really has placeholders to fill (else this suite proves nothing)", () => {
    expect(dpa().placeholders.length).toBeGreaterThan(0);
  });
  it("replaces every {placeholder} everywhere, leaves none, and moves the contentHash", () => {
    const doc = dpa();
    const filled = fillPlaceholders(doc, VALUES);
    const text = renderText(filled);
    expect(text).not.toMatch(/\{[a-zA-Z.]+\}/);
    for (const p of doc.placeholders) expect(text).toContain(VALUES[p]);
    expect(filled.placeholders).toEqual([]);
    expect(filled.contentHash).not.toBe(doc.contentHash);
  });
  it("refuses a MISSING value by name", () => {
    const doc = dpa();
    const { [doc.placeholders[0]!]: _gone, ...rest } = VALUES;
    expect(() => fillPlaceholders(doc, rest)).toThrow(doc.placeholders[0]!);
  });
  it("refuses an EMPTY value by name", () => {
    const doc = dpa();
    expect(() => fillPlaceholders(doc, { ...VALUES, [doc.placeholders[0]!]: "  " })).toThrow(doc.placeholders[0]!);
  });
  it("refuses an UNKNOWN key", () => {
    expect(() => fillPlaceholders(dpa(), { ...VALUES, ["customer.shoeSize" as Placeholder]: "44" })).toThrow("customer.shoeSize");
  });
});

describe("renderText + textHash", () => {
  it("renderText is deterministic", () => {
    const f = fillPlaceholders(dpa(), VALUES);
    expect(renderText(f)).toBe(renderText(fillPlaceholders(dpa(), VALUES)));
  });
  it("textHash is sha256:hex of the UTF-8 bytes (checked against node:crypto, with æøå)", () => {
    const t = renderText(fillPlaceholders(dpa(), VALUES));
    expect(textHash(t)).toBe(`sha256:${createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex")}`);
  });
});

function fakeBid(extra: Record<string, unknown> = {}) {
  const seen: any[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    seen.push(body);
    const { text: _t, ...stored } = body;
    return new Response(JSON.stringify({ sub: "u1", product: "cardmem", clientId: "c", acceptedAt: 1, ...stored, copy: "sent", ...extra }), { status: 201 });
  }) as typeof fetch;
  return { f, seen };
}

describe("recordAcceptance for a filled dpa (F110.20)", () => {
  const text = renderText(fillPlaceholders(dpa(), VALUES));
  it("sends text + authorityConfirmed and a contentHash over that text; returns authorityConfirmed + copy", async () => {
    const { f, seen } = fakeBid();
    const row = await recordAcceptance({ accessToken: "T", fetch: f }, { doc: "dpa", version: "v1", contentHash: textHash(text), text, authorityConfirmed: true });
    expect(seen[0]).toEqual({ doc: "dpa", version: "v1", contentHash: textHash(text), text, authorityConfirmed: true });
    expect([row.authorityConfirmed, row.copy]).toEqual([true, "sent"]);
  });
  it("refuses BEFORE the call when the hash is not over the text", async () => {
    const { f, seen } = fakeBid();
    await expect(recordAcceptance({ accessToken: "T", fetch: f }, { doc: "dpa", version: "v1", contentHash: "a".repeat(64), text, authorityConfirmed: true })).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(seen).toEqual([]);
  });
  it("refuses BEFORE the call a text over 200 000 characters", async () => {
    const { f, seen } = fakeBid();
    const big = "x".repeat(200_001);
    await expect(recordAcceptance({ accessToken: "T", fetch: f }, { doc: "dpa", version: "v1", contentHash: textHash(big), text: big, authorityConfirmed: true })).rejects.toMatchObject({ code: "text_too_long" });
    expect(seen).toEqual([]);
  });
  it("authorityConfirmed that BID does not echo → not_echoed", async () => {
    const { f } = fakeBid({ authorityConfirmed: false });
    await expect(recordAcceptance({ accessToken: "T", fetch: f }, { doc: "dpa", version: "v1", contentHash: textHash(text), text, authorityConfirmed: true })).rejects.toMatchObject({ code: "not_echoed" });
  });
  it("without the new fields the request body is exactly the 0.9.0 body", async () => {
    const { f, seen } = fakeBid();
    await recordAcceptance({ accessToken: "T", fetch: f }, { doc: "terms", version: "v1", contentHash: "b".repeat(64) });
    expect(seen[0]).toEqual({ doc: "terms", version: "v1", contentHash: `sha256:${"b".repeat(64)}` });
  });
});
