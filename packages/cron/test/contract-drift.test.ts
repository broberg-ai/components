import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs dev script, no types; the point is to test the logic, not to ship it.
import { checkContractDrift, EXIT, SPEC_URL } from "../scripts/contract-drift.mjs";

const SPEC = { openapi: "3.0.0", paths: {} };
const TYPES = "/**\n * auto-generated\n */\n\nexport interface paths { a: 1 }\n";

const deps = (over: Record<string, unknown> = {}) => ({
  fetchSpec: async () => SPEC,
  generate: async () => TYPES,
  readCurrent: () => TYPES,
  ...over,
});

describe("three outcomes, and the third is why this file exists", () => {
  it("in sync", async () => {
    const r = await checkContractDrift(deps());
    expect(r.status).toBe("in_sync");
  });

  it("drifted — and it NAMES the first difference rather than saying 'they differ'", async () => {
    const r = await checkContractDrift(
      deps({ readCurrent: () => TYPES.replace("a: 1", "a: 2") }),
    );
    expect(r.status).toBe("drifted");
    expect(r.diff.live).toContain("a: 1");
    expect(r.diff.ours).toContain("a: 2");
    expect(r.note).toContain("npm run gen");
  });

  it("AN UNREACHABLE SPEC IS NOT IN SYNC — the case this whole check turns on", async () => {
    const r = await checkContractDrift(
      deps({
        fetchSpec: async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        },
      }),
    );
    expect(r.status).toBe("could_not_ask");
    expect(r.status).not.toBe("in_sync");
    expect(r.status).not.toBe("drifted"); // nor a false alarm that trains us to ignore it
    expect(r.note).toContain(SPEC_URL);
  });

  it("a 200 carrying something that is NOT a spec is could_not_ask, never drift", async () => {
    // A proxy error page or a login redirect parses to a string/null. Calling
    // that drift would tell us to regenerate our types FROM NOTHING.
    for (const junk of ["<html>502</html>", null, undefined, 42]) {
      const r = await checkContractDrift(deps({ fetchSpec: async () => junk }));
      expect(r.status).toBe("could_not_ask");
    }
  });

  it("a spec that cannot be turned into types is could_not_ask, not drift", async () => {
    const r = await checkContractDrift(
      deps({
        generate: async () => {
          throw new Error("unsupported schema");
        },
      }),
    );
    expect(r.status).toBe("could_not_ask");
  });

  it("the banner differs between the CLI and the programmatic API — and must not count as drift", async () => {
    // Measured 2026-08-28: the two generators produce byte-identical output
    // below the header and different headers. Without stripping it, this check
    // would report drift on every single run and be switched off within a day.
    const r = await checkContractDrift(
      deps({ generate: async () => "/**\n * a different banner\n */\n\nexport interface paths { a: 1 }\n" }),
    );
    expect(r.status).toBe("in_sync");
  });

  it("the three exit codes are distinct — a caller can act on which one it got", () => {
    expect(new Set([EXIT.in_sync, EXIT.drifted, EXIT.could_not_ask]).size).toBe(3);
    expect(EXIT.in_sync).toBe(0);
  });
});
