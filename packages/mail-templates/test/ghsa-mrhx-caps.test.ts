// GHSA-mrhx-c7xc-m3w5 — zod 4.6.7 bounds only an array that HAS a .max(), and a
// record has none. A hostile override must cost ONE issue, not one per element.
import { describe, expect, it } from "vitest";
import { MailTemplateOverride, MailCopy, MailBrand, MAX_BLOCKS, MAX_FOOTER_LINES, MAX_COPY_KEYS } from "../src/index";

const bad = (n: number) => Array.from({ length: n }, () => ({ nope: 1 }));

describe("mail-templates — ceilings on a stored override", () => {
  it("blocks: MAX_BLOCKS+1 bad blocks → one issue; 200k → still one", () => {
    expect(MailTemplateOverride.safeParse({ blocks: bad(MAX_BLOCKS + 1) }).error!.issues.length).toBe(1);
    expect(MailTemplateOverride.safeParse({ blocks: bad(200_000) }).error!.issues.length).toBe(1);
  });
  it("footerLines: MAX_FOOTER_LINES+1 → one issue", () => {
    const r = MailBrand.safeParse({ footerLines: Array(MAX_FOOTER_LINES + 1).fill(7) });
    expect(r.error!.issues.filter((i) => i.path[0] === "footerLines").length).toBe(1);
  });
  it("copy: MAX_COPY_KEYS+1 bad phrases → one issue; 200k → still one", () => {
    const rec = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 1]));
    expect(MailCopy.safeParse(rec(MAX_COPY_KEYS + 1)).error!.issues.length).toBe(1);
    expect(MailCopy.safeParse(rec(200_000)).error!.issues.length).toBe(1);
  });
  it("normal input is unchanged: a small copy record passes, a bad value is still caught", () => {
    expect(MailCopy.parse({ greeting: "Hej" })).toEqual({ greeting: "Hej" });
    expect(MailCopy.safeParse({ greeting: 1 }).success).toBe(false);
    expect(MailCopy.safeParse(null).success).toBe(false);
  });
});
