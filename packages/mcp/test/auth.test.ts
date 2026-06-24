import { describe, it, expect } from "vitest";
import { validateBearerKey, hasScope } from "../src/auth";

const keys = [{ key: "secret-abc", label: "admin", scopes: ["a", "b"] }];

describe("validateBearerKey", () => {
  it("authenticates a correct Bearer key", () => {
    expect(validateBearerKey("Bearer secret-abc", keys)).toEqual({
      authenticated: true,
      label: "admin",
      scopes: ["a", "b"],
    });
  });

  it("rejects a missing header", () => {
    const r = validateBearerKey(null, keys);
    expect(r.authenticated).toBe(false);
  });

  it("rejects a malformed header", () => {
    expect(validateBearerKey("Token xyz", keys).authenticated).toBe(false);
  });

  it("rejects a wrong key of equal length", () => {
    expect(validateBearerKey("Bearer secret-xyz", keys).authenticated).toBe(false);
  });

  it("rejects a different-length key without throwing", () => {
    expect(validateBearerKey("Bearer s", keys).authenticated).toBe(false);
  });
});

describe("hasScope", () => {
  it("is AND across the required scopes", () => {
    expect(hasScope(["a", "b"], ["a", "b"])).toBe(true);
    expect(hasScope(["a"], ["a", "b"])).toBe(false);
    expect(hasScope(["a"], [])).toBe(true);
  });
});
