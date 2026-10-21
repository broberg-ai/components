// F040.2 — @broberg/mail-templates. Every render runs with the REAL @broberg/mail-core
// primitives, so a green test means the package and the shell agree, not that a stub did.
import { describe, expect, it } from "vitest";
import { cta, heading, noteBox, paragraph } from "@broberg/mail-core";
import {
  MailBrand,
  MailTemplate,
  canonicalContent,
  checkUrl,
  derivePreheader,
  hashContent,
  listEffectiveTemplates,
  renderTemplate,
  resolveTemplate,
  type MailPrimitives,
} from "../src/index";

const primitives: MailPrimitives = { heading, paragraph, noteBox, cta };
const opts = { accentColor: "#0f7391", primitives };

const base: MailTemplate = {
  purpose: "welcome",
  subject: "Velkommen {{navn}}",
  blocks: [
    { type: "heading", text: "Hej {{navn}}" },
    { type: "paragraph", text: "Kunde: {{firma}}" },
    { type: "button", text: "Log ind", url: "{{login_url}}" },
  ],
  brand: { senderName: "Team", colorAccent: "#0f7391" },
  copy: { signoff: "Med venlig hilsen" },
};

describe("AC1 — one escaping in the body, none in the subject", () => {
  it("«Sørensen & Søn» is escaped exactly once in the body and not at all in the subject", () => {
    const r = renderTemplate(
      { subject: "Ordre til {{firma}}", blocks: [{ type: "paragraph", text: "Kunde: {{firma}}" }] },
      opts,
      { firma: "Sørensen & Søn" },
    );
    expect(r.subject).toBe("Ordre til Sørensen & Søn");
    const p = r.html.match(/<p[^>]*>(.*)<\/p>/)?.[1];
    expect(p).toBe("Kunde: Sørensen &amp; Søn");
    expect(r.html).not.toContain("&amp;amp;");
  });
});

describe("AC2 — missing vs empty", () => {
  it("a missing value stays as the literal placeholder and is named — in body, subject and button url", () => {
    const r = renderTemplate(base, opts, {});
    expect(r.missing.sort()).toStrictEqual(["firma", "login_url", "navn"]);
    expect(r.subject).toBe("Velkommen {{navn}}");
    expect(r.html).toContain("Kunde: {{firma}}");
  });

  it("an EMPTY value is filled as empty and is not missing", () => {
    const r = renderTemplate(base, opts, { navn: "", firma: "", login_url: "https://x.dk/l" });
    expect(r.missing).toStrictEqual([]);
    expect(r.subject).toBe("Velkommen ");
    expect(r.html).toContain(">Kunde: </p>");
  });
});

describe("AC3 — a dead or hostile button is never a link", () => {
  const button = (url: string) => renderTemplate({ subject: "s", blocks: [{ type: "button", text: "Åbn", url: "{{u}}" }] }, opts, { u: url });

  it.each([
    ["relative", "/da/shop"],
    ["javascript:", "javascript:alert(1)"],
  ])("a %s url renders as plain text, with the reason in notes", (_n, url) => {
    const r = button(url);
    expect(r.html).not.toContain("<a ");
    expect(r.html).toContain(">Åbn</p>");
    expect(r.notes).toHaveLength(1);
  });

  it("an unfilled placeholder in the url renders as plain text with a note", () => {
    const r = renderTemplate({ subject: "s", blocks: [{ type: "button", text: "Åbn", url: "{{u}}" }] }, opts, {});
    expect(r.html).not.toContain("<a ");
    expect(r.notes[0]).toMatch(/unfilled placeholder/);
    expect(r.missing).toStrictEqual(["u"]);
  });

  it("a quote in the url value cannot close the href attribute", () => {
    const r = button('https://x.dk/"onmouseover="alert(1)');
    const href = r.html.match(/<a href="([^"]*)"/)?.[1];
    expect(href).toBe("https://x.dk/&quot;onmouseover=&quot;alert(1)");
    expect(r.html).not.toContain('" onmouseover');
    const tag = r.html.match(/<a [^>]*>/)?.[0] ?? "";
    const attrs = [...tag.matchAll(/\s([a-z-]+)="/g)].map((m) => m[1]);
    expect(attrs).toStrictEqual(["href", "style"]);
  });
});

describe("AC4 — brand injection is refused, naming the field", () => {
  it.each([
    ["colorAccent", '#fff;"></td></tr></table><a href="https://phish.example">Log ind her</a><table><tr><td x="'],
    ["fontSans", "Arial<script>"],
    ["fontSerif", 'Georgia";x'],
  ])("%s with an injection string is a zod error on that field", (field, value) => {
    const r = MailBrand.safeParse({ [field]: value });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toStrictEqual([field]);
  });

  it("real colours and stacks pass", () => {
    expect(MailBrand.safeParse({ colorAccent: "rebeccapurple", colorInk: "#1a1c2b", fontSans: "'DM Sans',Arial,sans-serif" }).success).toBe(true);
  });
});

describe("AC5 — override over the coded default", () => {
  it("resolveTemplate: no override → the default; an override replaces subject and merges brand", () => {
    expect(resolveTemplate(base, undefined)).toBe(base);
    const eff = resolveTemplate(base, { subject: "Hej igen", brand: { colorAccent: "#000000" } });
    expect(eff.subject).toBe("Hej igen");
    expect(eff.blocks).toBe(base.blocks);
    expect(eff.brand).toStrictEqual({ senderName: "Team", colorAccent: "#000000" });
    expect(eff.copy).toStrictEqual({ signoff: "Med venlig hilsen" });
  });

  it("listEffectiveTemplates: isCustom per purpose, and an override for an unknown purpose is NAMED", () => {
    const reset: MailTemplate = { ...base, purpose: "reset", subject: "Nulstil" };
    const r = listEffectiveTemplates([base, reset], { welcome: { subject: "Velkommen!" }, old_invite: { subject: "x" } });
    expect(r.templates.map((t) => [t.purpose, t.isCustom, t.effective.subject])).toStrictEqual([
      ["welcome", true, "Velkommen!"],
      ["reset", false, "Nulstil"],
    ]);
    expect(r.templates[0]?.default.subject).toBe("Velkommen {{navn}}");
    expect(r.unknownOverrides).toStrictEqual(["old_invite"]);
  });

  it("an empty override object is not custom", () => {
    expect(listEffectiveTemplates([base], { welcome: {} }).templates[0]?.isCustom).toBe(false);
  });
});

describe("AC6 — content hash", () => {
  it("key ORDER does not change the hash; one changed character does", async () => {
    const a = { purpose: "p", subject: "s", blocks: [{ type: "paragraph" as const, text: "hej" }], brand: { senderName: "A", partner: "B" } };
    const b = { brand: { partner: "B", senderName: "A" }, blocks: [{ text: "hej", type: "paragraph" as const }], subject: "s", purpose: "p" };
    expect(canonicalContent(a)).toBe(canonicalContent(b));
    expect(await hashContent(canonicalContent(a))).toBe(await hashContent(canonicalContent(b)));
    const c = { ...a, blocks: [{ type: "paragraph" as const, text: "hej!" }] };
    expect(await hashContent(canonicalContent(c))).not.toBe(await hashContent(canonicalContent(a)));
  });
});

describe("rules carried from F298", () => {
  it("derivePreheader: explicit wins; otherwise the first paragraph, cut on a word", () => {
    expect(derivePreheader(base.blocks, " Givet ")).toBe("Givet");
    const long = "ord ".repeat(50).trim();
    const p = derivePreheader([{ type: "paragraph", text: long }]);
    expect(p.endsWith("…")).toBe(true);
    expect(p.length).toBeLessThanOrEqual(118);
    expect(p).not.toMatch(/\bor…$/);
  });

  it("checkUrl: a lone placeholder is fine at authoring time and refused once filled", () => {
    expect(checkUrl("{{u}}")).toStrictEqual({ ok: true });
    expect(checkUrl("{{u}}", { filled: true }).ok).toBe(false);
    expect(checkUrl("mailto:a@b.dk").ok).toBe(true);
  });

  it("brace prose that is not a token is noted", () => {
    const r = renderTemplate({ subject: "s", blocks: [{ type: "paragraph", text: "{{brevets tekst her}}" }] }, opts, {});
    expect(r.notes[0]).toMatch(/looks like a placeholder but is not one/);
  });

  it("the html block is raw, a paragraph is escaped, and a value in an html block is escaped unless its key is raw", () => {
    const tpl = { subject: "s", blocks: [{ type: "html" as const, text: "<h2>A</h2>{{body}}" }, { type: "paragraph" as const, text: "<b>x</b>" }] };
    const esc = renderTemplate(tpl, opts, { body: "<p>B</p>" });
    expect(esc.html).toContain("<h2>A</h2>&lt;p&gt;B&lt;/p&gt;");
    expect(esc.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    const raw = renderTemplate(tpl, { ...opts, rawValueKeys: ["body"] }, { body: "<p>B</p>" });
    expect(raw.html).toContain("<h2>A</h2><p>B</p>");
  });
});

describe("AC7 — browser-safe: no mail-core and no node:fs in the package itself", () => {
  it("src imports only zod", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toStrictEqual(["zod"]);
  });
});
