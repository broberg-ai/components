// F035.17 — the vault survey of 30 Sep 2026.
//
// Every shape here was MEASURED on a value already in cardmem's vault (a script
// read them server-side and printed only prefix, length and charset), then
// checked against a source. The fixtures are SYNTHETIC — built to the measured
// shape, never a real value — so this file carries nothing to rotate.
import { describe, it, expect } from "vitest";
import { redactSecrets, classify } from "../src/index";

const rep = (alphabet: string, n: number) =>
  Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join("");
const ALNUM = "ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnpqrstuvwxyz0123456789";
const UPNUM = "ABCDEFGHJKMNPQRSTVWXYZ0123456789";
const HEX = "0123456789abcdef";
const B64URL = ALNUM + "-_";

/** [label, a value of the measured shape, the same value one character short] */
const FIXED: Array<[string, string, string]> = [
  ["cloudflare-user-api-token", `cfut_${rep(ALNUM, 48)}`, `cfut_${rep(ALNUM, 40)}`],
  ["runpod-api-key", `rpa_${rep(UPNUM, 40)}${rep(ALNUM, 6)}`, `rpa_${rep(UPNUM, 40)}${rep(ALNUM, 5)}`],
  ["huggingface-token", `hf_${rep(ALNUM, 34)}`, `hf_${rep(ALNUM, 33)}`],
  ["huggingface-token", `api_org_${rep(ALNUM, 34)}`, `api_org_${rep(ALNUM, 33)}`],
  ["tailscale-key", `tskey-auth-${rep(ALNUM, 12)}-${rep(ALNUM, 37)}`, `tskey-auth-${rep(ALNUM, 19)}`],
  ["tigris-secret-key", `tsec_${rep(ALNUM + "+", 70)}`, `tsec_${rep(ALNUM + "+", 69)}`],
  ["aiven-service-password", `AVNS_${rep(B64URL, 19)}`, `AVNS_${rep(B64URL, 18)}`],
  ["bid-app-key", `bidk_${rep(B64URL, 43)}`, `bidk_${rep(B64URL, 42)}`],
  ["beacon-token", `bcn_${rep(HEX, 64)}`, `bcn_${rep(HEX, 63)}`],
  ["mailworker-admin-key", `mw_${rep(HEX, 64)}`, `mw_${rep(HEX, 63)}`],
  ["upmetrics-remediation-token", `umrt_${rep(HEX, 48)}`, `umrt_${rep(HEX, 47)}`],
];

describe("each new type is named from its measured shape", () => {
  it.each(FIXED)("%s", (label, value) => {
    expect(classify(value)?.label).toBe(label);
    expect(redactSecrets(`X=${value}`).redacted).not.toContain(value);
  });

  it.each(FIXED)("%s — one character short is not it", (label, _value, short) => {
    expect(classify(short)?.label ?? null).not.toBe(label);
  });

  it("an xapp- Slack app token is a slack-token (xox* was all we knew)", () => {
    const t = `xapp-1-A${rep(UPNUM, 10)}-${rep("0123456789", 13)}-${rep(HEX, 64)}`;
    expect(classify(t)?.label).toBe("slack-token");
  });

  it("a fixed-hex key followed by one more hex digit is not a key", () => {
    const long = `bcn_${rep(HEX, 65)}`;
    expect(classify(long)).toBe(null);
  });
});

describe("connection-string: the password goes, the address stays", () => {
  const PW = `Zq${rep(ALNUM, 22)}9`;

  it.each(["postgres", "postgresql", "mysql", "mongodb+srv", "redis", "rediss", "amqps"])(
    "%s:// with a password is classified",
    (scheme) => {
      expect(classify(`${scheme}://app:${PW}@db.example.com:5432/app`)?.label).toBe("connection-string");
    },
  );

  it("redacts ONLY the password — scheme, user, host and database stay readable", () => {
    const url = `postgres://app:${PW}@db.example.com:5432/app?sslmode=require`;
    const { redacted } = redactSecrets(url);
    expect(redacted).not.toContain(PW);
    expect(redacted.startsWith("postgres://app:")).toBe(true);
    expect(redacted.endsWith("@db.example.com:5432/app?sslmode=require")).toBe(true);
  });

  it.each([
    "postgres://user:password@localhost:5432/db",
    "postgres://user:pass@localhost/db",
    "postgres://localhost:5432/db",
    "postgres://user@localhost/db",
    "https://app:" + PW + "@example.com/", // not a database scheme
  ])("leaves %s alone", (url) => {
    expect(classify(url)).toBe(null);
    expect(redactSecrets(url).redacted).toBe(url);
  });
});
