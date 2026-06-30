import { describe, it, expect } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import { buildAuthOptions, buildPasskeyPlugin } from "../src/index.js";

describe("passkey registration (dark-ship)", () => {
  it("registers the passkey plugin only when config.passkey is provided", () => {
    const pkId = buildPasskeyPlugin({ rpID: "example.com", rpName: "Example" }).id;

    const withPk = buildAuthOptions({
      database: memoryAdapter({}),
      passkey: { rpID: "example.com", rpName: "Example" },
    });
    expect(withPk.plugins?.some((p) => p.id === pkId)).toBe(true);

    const withoutPk = buildAuthOptions({ database: memoryAdapter({}) });
    expect(withoutPk.plugins).toBeUndefined();
  });

  it("builds a passkey plugin with rpID/rpName/origin without throwing", () => {
    expect(() =>
      buildPasskeyPlugin({
        rpID: "xrt81.com",
        rpName: "XRT81",
        origin: "https://xrt81.com",
      }),
    ).not.toThrow();
  });

  it("does not crash createAuth-style assembly when passkey is unset", () => {
    expect(() => buildAuthOptions({ database: memoryAdapter({}) })).not.toThrow();
  });
});
