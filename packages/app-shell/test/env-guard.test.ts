// @vitest-environment happy-dom
// The test environment must never reach the network. Without these settings
// happy-dom follows a clicked https:// link, fetches the live page and runs its
// scripts — the flaky «Cannot use import statement outside a module» that broke
// two publish runs on 2026-10-08. This file fails if vitest.config.ts loses them.
import { describe, expect, it } from "vitest";

describe("happy-dom stays offline", () => {
  it("navigation and script loading are switched off", () => {
    const s = (window as unknown as { happyDOM: { settings: Record<string, any> } }).happyDOM.settings;
    expect([
      s.disableJavaScriptFileLoading,
      s.disableJavaScriptEvaluation,
      s.navigation.disableMainFrameNavigation,
      s.navigation.disableChildPageNavigation,
    ]).toEqual([true, true, true, true]);
  });
  it("clicking an external link does not navigate the test window", () => {
    const a = document.createElement("a");
    a.href = "https://id.broberg.ai/account";
    document.body.appendChild(a);
    const before = window.location.href;
    a.click();
    expect(window.location.href).toBe(before);
    a.remove();
  });
});
