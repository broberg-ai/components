import { describe, it, expect } from "vitest";
import { resolve3TierAuth } from "../src/three-tier-auth";
import type { Principal } from "../src/types";

const webReq = (auth?: string) =>
  new Request("http://x", auth ? { headers: { authorization: auth } } : undefined);

describe("resolve3TierAuth", () => {
  it("tier 1: a matching API key resolves to its principal (viaSession=false)", async () => {
    const authenticate = resolve3TierAuth<Request>({
      apiKey: (token) => (token === "pa_good" ? ({ userId: "u1", scopes: ["read"] } as Principal) : null),
    });
    const { principal } = await authenticate(webReq("Bearer pa_good"));
    expect(principal.userId).toBe("u1");
    expect(principal.viaSession).toBe(false);
  });

  it("falls through API key → session when the key misses", async () => {
    const tried: string[] = [];
    const authenticate = resolve3TierAuth<Request>({
      apiKey: () => {
        tried.push("apiKey");
        return null;
      },
      session: () => {
        tried.push("session");
        return { userId: "sess" } as Principal;
      },
    });
    const { principal } = await authenticate(webReq("Bearer pa_x"));
    expect(tried).toEqual(["apiKey", "session"]);
    expect(principal.userId).toBe("sess");
    expect(principal.viaSession).toBe(true); // stamped for the session tier
  });

  it("apiKeyPrefix gating: a non-prefixed bearer skips the apiKey tier", async () => {
    const tried: string[] = [];
    const authenticate = resolve3TierAuth<Request>({
      apiKeyPrefix: "pa_",
      apiKey: () => {
        tried.push("apiKey");
        return { userId: "key" } as Principal;
      },
      bootstrap: () => {
        tried.push("bootstrap");
        return { userId: "boot" } as Principal;
      },
    });
    const { principal } = await authenticate(webReq("Bearer sk_other"));
    expect(tried).toEqual(["bootstrap"]); // apiKey skipped (wrong prefix)
    expect(principal.userId).toBe("boot");
  });

  it("throws unauthorized when every tier misses (→ 401 at the boundary)", async () => {
    const authenticate = resolve3TierAuth<Request>({ apiKey: () => null, session: () => null });
    await expect(authenticate(webReq("Bearer pa_nope"))).rejects.toThrow("unauthorized");
  });

  it("ctxFor derives the host ctx from the resolved principal", async () => {
    const authenticate = resolve3TierAuth<Request, { org: string }>(
      { session: () => ({ orgId: "acme" } as Principal) },
      (p) => ({ org: p.orgId ?? "none" }),
    );
    const { ctx } = await authenticate(webReq());
    expect(ctx).toEqual({ org: "acme" });
  });

  it("default getAuthHeader reads a Node-style headers bag too", async () => {
    const authenticate = resolve3TierAuth<{ headers: Record<string, string> }>({
      apiKey: (token) => ({ userId: token } as Principal),
    });
    const { principal } = await authenticate({ headers: { authorization: "Bearer pa_node" } });
    expect(principal.userId).toBe("pa_node");
  });

  it("respects a viaSession value the callback set explicitly", async () => {
    const authenticate = resolve3TierAuth<Request>({
      apiKey: () => ({ userId: "u", viaSession: true } as Principal),
    });
    const { principal } = await authenticate(webReq("Bearer pa_x"));
    expect(principal.viaSession).toBe(true); // not overwritten by the tier default
  });
});
