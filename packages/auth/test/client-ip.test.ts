// Security review 2026-W41, H2 — Better Auth's rate limit must count per REAL client IP.
// A forged X-Forwarded-For must not buy fresh attempts, and Fly's own Fly-Client-IP is the key.
// Driven through a real Better Auth instance (1.6.22+), not the options object alone.
import { describe, it, expect } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuth, buildAuthOptions, CLIENT_IP_HEADERS } from "../src/index.js";

const TEST_SECRET = "test-only-secret-xK7pQ2mR9vTnW4bYcHsEdZgLjF8aU3o=";
const BASE = "http://localhost:3000";

function auth() {
  return createAuth({ database: memoryAdapter({ user: [], session: [], account: [], verification: [] }), secret: TEST_SECRET, baseURL: BASE, emailPassword: true, extend: { rateLimit: { enabled: true, window: 60, max: 100 } } });
}
/** One wrong sign-in; returns the status. */
async function signIn(a: ReturnType<typeof auth>, headers: Record<string, string>): Promise<number> {
  const res = await a.handler(new Request(`${BASE}/api/auth/sign-in/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: BASE, ...headers },
    body: JSON.stringify({ email: "anne@eksempel.dk", password: "wrong-password-123" }),
  }));
  return res.status;
}

describe("2026-W41 H2 — the rate limit counts per real client IP", () => {
  it("the default reads Fly-Client-IP, under any advanced options the consumer passes (their ipAddress wins)", () => {
    expect(CLIENT_IP_HEADERS).toStrictEqual(["fly-client-ip"]);
    const base = { database: memoryAdapter({}), secret: TEST_SECRET };
    expect(buildAuthOptions(base).advanced).toStrictEqual({ ipAddress: { ipAddressHeaders: ["fly-client-ip"] } });
    expect(buildAuthOptions({ ...base, extend: { advanced: { useSecureCookies: true } } }).advanced).toStrictEqual({ useSecureCookies: true, ipAddress: { ipAddressHeaders: ["fly-client-ip"] } });
    expect(buildAuthOptions({ ...base, extend: { advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } } } }).advanced).toStrictEqual({ ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } });
  });

  it("a NEW forged X-Forwarded-For on every try buys no fresh attempts: the same Fly-Client-IP is limited (429)", async () => {
    const a = auth();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push(await signIn(a, { "fly-client-ip": "203.0.113.7", "x-forwarded-for": i % 2 ? `garbage-${i}` : `198.51.100.${i}` }));
    expect(statuses).toContain(429);
  });

  it("NEGATIVE CONTROL: different real clients are different buckets — one attacker does not lock everybody out", async () => {
    const a = auth();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push(await signIn(a, { "fly-client-ip": `203.0.113.${10 + i}`, "x-forwarded-for": "garbage" }));
    expect(statuses).not.toContain(429);
  });
});
