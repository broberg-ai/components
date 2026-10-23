// F038.40 — ⌘K works on every page with the top bar, not only the front page.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
process.env.ENROLL_DB_URL = ":memory:";
import { app } from "./server";
import { getEnrollStore } from "./enroll";

const login = async () => {
  const k = "q".repeat(64);
  await (await getEnrollStore())!.bindSessionKey("t-cmdk", createHash("sha256").update(k).digest("hex"));
  return { "x-discovery-session": "t-cmdk", "x-enroll-key": k };
};
const inv = readFileSync(new URL("../../docs/inventory.html", import.meta.url), "utf8");
const inline = JSON.parse(inv.match(/var SEARCH=(\[.*?\]);/)![1]);
const has = (html: string) => ({
  button: html.includes('data-testid="inv-search-open"'),
  modal: html.includes('data-testid="inv-search-modal"'),
  shortcut: html.includes("if((e.metaKey||e.ctrlKey)&&(e.key==='k'||e.key==='K')){e.preventDefault();openSearch();return;}"),
});

describe("F038.40 ⌘K on every page", () => {
  for (const path of ["/packages", "/packages/@broberg/theme", "/tickets"]) {
    it(`${path} has the button, the modal and the shortcut`, async () => {
      const res = await app.request(path, { headers: await login() });
      expect(res.status).toBe(200);
      expect(has(await res.text())).toEqual({ button: true, modal: true, shortcut: true });
    });
  }

  it("the front page still has them, once each", () => {
    expect(has(inv)).toEqual({ button: true, modal: true, shortcut: true });
    expect(inv.split('data-testid="inv-search-modal"').length - 1).toBe(1);
    expect(inv.split("e.metaKey||e.ctrlKey").length - 1).toBe(1);
  });

  it("/search-index.json is the front page's own index, and sits behind the login", async () => {
    expect((await app.request("/search-index.json")).status).toBe(401);
    const res = await app.request("/search-index.json", { headers: await login() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual(inline);
  });

  it("a result without a page lands on the front page's drawer via /#open=<F>", () => {
    expect(inv).toContain("location.href='/#open='+encodeURIComponent(f)");
    expect(inv).toContain("var mOpen=/^#open=(.+)$/.exec(location.hash);if(mOpen){try{openDrawerByF(decodeURIComponent(mOpen[1]));}");
  });
});
