import { describe, it, expect } from "vitest";
import { buildPayload, buildSilentPayload } from "../src/index";
import { urlBase64ToUint8Array } from "../src/client";

describe("buildPayload — dual-shape (declarative + classic)", () => {
  it("emits BOTH the declarative web_push:8030 object AND flat classic-SW fields", () => {
    const p = JSON.parse(
      buildPayload({ title: "Hi", body: "there", navigate: "/x", badge: 3, icon: "/i.png", tag: "t1" }),
    );
    // declarative (Safari 18.4+ renders without a SW)
    expect(p.web_push).toBe(8030);
    expect(p.notification.title).toBe("Hi");
    expect(p.notification.body).toBe("there");
    expect(p.notification.navigate).toBe("/x");
    expect(p.notification.app_badge).toBe(3);
    // classic-SW fallback (Chrome/Firefox)
    expect(p.title).toBe("Hi");
    expect(p.body).toBe("there");
    expect(p.navigate).toBe("/x");
    expect(p.badge).toBe(3);
    expect(p.icon).toBe("/i.png");
    expect(p.tag).toBe("t1");
  });

  it("omits app_badge from the declarative object when badge is not a number", () => {
    const p = JSON.parse(buildPayload({ title: "T", body: "B" }));
    expect("app_badge" in p.notification).toBe(false);
    expect(p.web_push).toBe(8030);
  });
});

describe("buildSilentPayload — data-only badge push (no banner)", () => {
  it("carries the badge but NO web_push and NO title/body (so Safari won't render)", () => {
    const p = JSON.parse(buildSilentPayload({ badge: 4, tag: "sync" }));
    expect(p.silent).toBe(true);
    expect(p.app_badge).toBe(4);
    expect(p.badge).toBe(4);
    expect(p.tag).toBe("sync");
    expect("web_push" in p).toBe(false); // not declarative → no auto-render
    expect("title" in p).toBe(false);
    expect("notification" in p).toBe(false);
  });

  it("badge 0 (clear) is still expressed so the SW can clearAppBadge", () => {
    const p = JSON.parse(buildSilentPayload({ badge: 0 }));
    expect(p.silent).toBe(true);
    expect(p.app_badge).toBe(0);
  });
});

describe("urlBase64ToUint8Array — VAPID key decode", () => {
  it("decodes a padless base64url string to the right bytes ('hello')", () => {
    expect(Array.from(urlBase64ToUint8Array("aGVsbG8"))).toEqual([104, 101, 108, 108, 111]);
  });

  it("handles the base64url -_ alphabet (maps to +/)", () => {
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});
