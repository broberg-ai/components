import { describe, expect, it } from "vitest";
import {
  evaluateToken,
  ipInCidr,
  selectTenant,
  TenantAccessError,
  type TokenGrant,
} from "../src/authorize";

describe("evaluateToken — TTL gate", () => {
  const grant: TokenGrant = { permissions: ["*"], notBefore: 100, notAfter: 200 };
  it("denies before notBefore", () => {
    expect(evaluateToken(grant, { permission: "x:y", now: 50 })).toEqual({ allowed: false, reason: "not_yet_valid" });
  });
  it("denies after notAfter", () => {
    expect(evaluateToken(grant, { permission: "x:y", now: 250 })).toEqual({ allowed: false, reason: "expired" });
  });
  it("allows inside the window", () => {
    expect(evaluateToken(grant, { permission: "x:y", now: 150 }).allowed).toBe(true);
  });
});

describe("evaluateToken — permission gate", () => {
  it("exact, area-wildcard and global match", () => {
    expect(evaluateToken({ permissions: ["content:read"] }, { permission: "content:read" }).allowed).toBe(true);
    expect(evaluateToken({ permissions: ["content:*"] }, { permission: "content:write" }).allowed).toBe(true);
    expect(evaluateToken({ permissions: ["*"] }, { permission: "deploy:trigger" }).allowed).toBe(true);
  });
  it("denies an unmatched permission", () => {
    expect(evaluateToken({ permissions: ["content:read"] }, { permission: "deploy:trigger" })).toEqual({
      allowed: false,
      reason: "permission_denied",
    });
  });
});

describe("evaluateToken — resource cascade (exclude wins)", () => {
  const grant: TokenGrant = {
    permissions: ["deploy:trigger"],
    resources: [{ scope: "site", effect: "include", targets: ["fysiodk"] }],
  };
  it("allows the included target", () => {
    expect(evaluateToken(grant, { permission: "deploy:trigger", resource: { scope: "site", target: "fysiodk" } }).allowed).toBe(true);
  });
  it("denies a non-included target in the same scope", () => {
    expect(evaluateToken(grant, { permission: "deploy:trigger", resource: { scope: "site", target: "other" } })).toEqual({
      allowed: false,
      reason: "resource_denied",
    });
  });
  it("ignores scopes that have no filter (no constraint there)", () => {
    expect(evaluateToken(grant, { permission: "deploy:trigger", resource: { scope: "org", target: "anything" } }).allowed).toBe(true);
  });
  it("exclude beats include for the same target", () => {
    const g: TokenGrant = {
      permissions: ["content:read"],
      resources: [
        { scope: "site", effect: "include", targets: "*" },
        { scope: "site", effect: "exclude", targets: ["secret"] },
      ],
    };
    expect(evaluateToken(g, { permission: "content:read", resource: { scope: "site", target: "public" } }).allowed).toBe(true);
    expect(evaluateToken(g, { permission: "content:read", resource: { scope: "site", target: "secret" } }).allowed).toBe(false);
  });
});

describe("evaluateToken — CIDR gate", () => {
  it("mode:in requires the ip inside one of the cidrs", () => {
    const g: TokenGrant = { permissions: ["*"], ipFilters: [{ mode: "in", cidrs: ["10.0.0.0/8"] }] };
    expect(evaluateToken(g, { permission: "x:y", ip: "10.1.2.3" }).allowed).toBe(true);
    expect(evaluateToken(g, { permission: "x:y", ip: "192.168.0.1" })).toEqual({ allowed: false, reason: "ip_denied" });
  });
  it("mode:not_in rejects ips inside the cidrs", () => {
    const g: TokenGrant = { permissions: ["*"], ipFilters: [{ mode: "not_in", cidrs: ["192.168.0.0/16"] }] };
    expect(evaluateToken(g, { permission: "x:y", ip: "192.168.5.5" }).allowed).toBe(false);
    expect(evaluateToken(g, { permission: "x:y", ip: "8.8.8.8" }).allowed).toBe(true);
  });
  it("no ip in context = CIDR gate skipped", () => {
    const g: TokenGrant = { permissions: ["*"], ipFilters: [{ mode: "in", cidrs: ["10.0.0.0/8"] }] };
    expect(evaluateToken(g, { permission: "x:y" }).allowed).toBe(true);
  });
});

describe("evaluateToken — full cms F134 cascade", () => {
  // "deploy:trigger only on site:fysiodk, from the office network, valid this year"
  const grant: TokenGrant = {
    permissions: ["deploy:trigger"],
    resources: [{ scope: "site", effect: "include", targets: ["fysiodk"] }],
    ipFilters: [{ mode: "in", cidrs: ["203.0.113.0/24"] }],
    notBefore: 1_700_000_000_000,
    notAfter: 1_800_000_000_000,
  };
  const now = 1_750_000_000_000;
  it("passes when every gate is satisfied", () => {
    expect(evaluateToken(grant, { permission: "deploy:trigger", resource: { scope: "site", target: "fysiodk" }, ip: "203.0.113.5", now }).allowed).toBe(true);
  });
  it("fails on the first failing gate (wrong site)", () => {
    expect(evaluateToken(grant, { permission: "deploy:trigger", resource: { scope: "site", target: "elsewhere" }, ip: "203.0.113.5", now }).reason).toBe("resource_denied");
  });
  it("fails on a foreign IP", () => {
    expect(evaluateToken(grant, { permission: "deploy:trigger", resource: { scope: "site", target: "fysiodk" }, ip: "8.8.8.8", now }).reason).toBe("ip_denied");
  });
});

describe("ipInCidr", () => {
  it("IPv4 ranges", () => {
    expect(ipInCidr("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(ipInCidr("11.0.0.1", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("192.168.1.50", "192.168.1.0/24")).toBe(true);
    expect(ipInCidr("192.168.2.50", "192.168.1.0/24")).toBe(false);
    expect(ipInCidr("1.2.3.4", "0.0.0.0/0")).toBe(true); // match-all
  });
  it("IPv4 bare address = exact match", () => {
    expect(ipInCidr("1.2.3.4", "1.2.3.4")).toBe(true);
    expect(ipInCidr("1.2.3.5", "1.2.3.4")).toBe(false);
  });
  it("IPv6 ranges incl. :: compression", () => {
    expect(ipInCidr("2001:db8::1", "2001:db8::/32")).toBe(true);
    expect(ipInCidr("2001:dead::1", "2001:db8::/32")).toBe(false);
    expect(ipInCidr("::1", "::1")).toBe(true);
    expect(ipInCidr("fe80::1", "fe80::/10")).toBe(true);
  });
  it("cross-version never matches; malformed input is false, not a throw", () => {
    expect(ipInCidr("10.0.0.1", "2001:db8::/32")).toBe(false);
    expect(ipInCidr("not-an-ip", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("10.0.0.999", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("10.0.0.1", "10.0.0.0/99")).toBe(false);
  });
});

describe("selectTenant — trail selector-not-grant", () => {
  const isMember = (slug: string) => ["club-a", "club-b"].includes(slug);

  it("spansAll + member slug → that tenant", () => {
    expect(selectTenant({ requestedSlug: "club-b", homeTenant: "club-a", spansAll: true, isMember })).toBe("club-b");
  });
  it("spansAll + non-member slug → HARD refuse (throws, no silent home-fallback)", () => {
    expect(() => selectTenant({ requestedSlug: "club-x", homeTenant: "club-a", spansAll: true, isMember })).toThrow(TenantAccessError);
  });
  it("spansAll + no selector → home", () => {
    expect(selectTenant({ homeTenant: "club-a", spansAll: true, isMember })).toBe("club-a");
  });
  it("home-bound key (spansAll:false) ignores the selector → home", () => {
    expect(selectTenant({ requestedSlug: "club-b", homeTenant: "club-a", spansAll: false, isMember })).toBe("club-a");
  });
  it("requesting your own home is always fine", () => {
    expect(selectTenant({ requestedSlug: "club-a", homeTenant: "club-a", spansAll: true, isMember })).toBe("club-a");
  });
});
