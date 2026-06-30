import { describe, it, expect } from "vitest";
import { gravatarHash, gravatarUrl, getInitials } from "../src/index.js";

// F013.1 — headless core
describe("gravatarHash", () => {
  it("returns lowercase hex SHA-256 (64 chars)", async () => {
    const h = await gravatarHash("test@example.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalises: uppercase email → same hash as lowercase", async () => {
    const lower = await gravatarHash("user@example.com");
    const upper = await gravatarHash("USER@EXAMPLE.COM");
    expect(lower).toBe(upper);
  });

  it("normalises: leading/trailing whitespace stripped", async () => {
    const clean = await gravatarHash("user@example.com");
    const padded = await gravatarHash("  user@example.com  ");
    expect(clean).toBe(padded);
  });

  it("different emails produce different hashes", async () => {
    const a = await gravatarHash("a@example.com");
    const b = await gravatarHash("b@example.com");
    expect(a).not.toBe(b);
  });

  it("empty string does not throw and returns 64-char hex", async () => {
    const h = await gravatarHash("");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("gravatarUrl", () => {
  it("contains hash, s= param, and d=404 by default", async () => {
    const url = await gravatarUrl("test@example.com", { size: 80 });
    const hash = await gravatarHash("test@example.com");
    expect(url).toContain(hash);
    expect(url).toContain("s=80");
    expect(url).toContain("d=404");
  });

  it("uses d=mp when specified", async () => {
    const url = await gravatarUrl("x@x.com", { default: "mp" });
    expect(url).toContain("d=mp");
  });

  it("does not include v= when cacheBust is false (default)", async () => {
    const url = await gravatarUrl("x@x.com");
    expect(url).not.toContain("v=");
  });

  it("includes v= when cacheBust is true", async () => {
    const url = await gravatarUrl("x@x.com", { cacheBust: true });
    expect(url).toMatch(/v=\d+/);
  });

  it("points to www.gravatar.com/avatar/", async () => {
    const url = await gravatarUrl("x@x.com");
    expect(url).toMatch(/^https:\/\/www\.gravatar\.com\/avatar\//);
  });
});

// F013.2 — getInitials helper
describe("getInitials", () => {
  it("two-word name → first letter of first + last word, uppercase", () => {
    expect(getInitials("Anna Hansen")).toBe("AH");
  });

  it("three-word name → first + last word initials", () => {
    expect(getInitials("Anna Mette Nielsen")).toBe("AN");
  });

  it("single word → first two chars, uppercase", () => {
    expect(getInitials("Anna")).toBe("AN");
  });

  it("null name, email provided → first two chars of email prefix", () => {
    expect(getInitials(null, "anna@example.com")).toBe("AN");
  });

  it("undefined name, email provided → first two chars of email prefix", () => {
    expect(getInitials(undefined, "cb@webhouse.dk")).toBe("CB");
  });

  it("both null → '??'", () => {
    expect(getInitials(null, null)).toBe("??");
  });

  it("both undefined → '??'", () => {
    expect(getInitials(undefined, undefined)).toBe("??");
  });

  it("empty name string → falls through to email", () => {
    expect(getInitials("", "ab@x.com")).toBe("AB");
  });
});
