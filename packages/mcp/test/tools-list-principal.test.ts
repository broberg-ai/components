import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { defineTool } from "../src/tools";
import { registerTools } from "../src/register";
import type { AnyToolDef, Principal } from "../src/types";

/**
 * F007.13 — `tools/list` must answer "what may YOU call", not "what exists".
 *
 * Filed by pitch-vault from their production: a read-only key was listed all
 * seven tools, including the two writes. The gate refused the write correctly
 * (they checked the database, not the error text), so this was never a hole in
 * the enforcement — it was a catalogue that promised what the gate would deny.
 *
 * Measured through a REAL client/server link rather than by calling the
 * predicate, because the predicate being right and the LISTING being filtered
 * are two different claims, and only the second one is the bug.
 */

const tools: AnyToolDef[] = [
  defineTool({ name: "read_one", description: "a read tool", inputSchema: {}, handler: () => "r1" }),
  defineTool({ name: "read_two", description: "another read tool", inputSchema: {}, handler: () => "r2" }),
  defineTool({
    name: "write_one",
    description: "a write tool",
    kind: "write",
    inputSchema: {},
    handler: () => "w1",
  }),
  defineTool({
    name: "scoped_admin",
    description: "gated on a scope",
    scopes: ["admin"],
    inputSchema: {},
    handler: () => "s1",
  }),
];

async function connect(principal: Principal): Promise<Client> {
  const server = new Server({ name: "test", version: "0.0.0" }, { capabilities: { tools: {} } });
  registerTools(server, tools, { getContext: () => ({ principal, ctx: undefined }) });
  const client = new Client({ name: "c", version: "0.0.0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

async function listed(principal: Principal): Promise<string[]> {
  const client = await connect(principal);
  const { tools: got } = await client.listTools();
  return got.map((t) => t.name).sort();
}

/** Everything a fully-privileged principal sees — the ceiling every case is judged against. */
const ALL = ["read_one", "read_two", "scoped_admin", "write_one"];

describe("F007.13 — tools/list is filtered by the calling principal", () => {
  it("AC#1 — a read-only principal is not shown the write tool", async () => {
    // Holds `admin`, so the ONLY thing that can remove a tool here is read-only.
    expect(await listed({ readOnly: true, scopes: ["admin"] })).toEqual([
      "read_one",
      "read_two",
      "scoped_admin",
    ]);
  });

  it("AC#2 — NEGATIVE CONTROL: a principal with write access still sees everything", async () => {
    // Without this, AC#1 also passes if the filter removes all tools, or every
    // tool but the three it happens to name.
    expect(await listed({ scopes: ["admin"] })).toEqual(ALL);
  });

  /**
   * AC#2b — the INVARIANT, not another case.
   *
   * The card's whole point is that the catalogue and the gate must never be
   * able to disagree, so the test asserts exactly that, for every principal
   * shape: each LISTED tool is callable, and each ABSENT one is refused.
   * A test that hardcoded one more expected array would go green on a filter
   * that drifted in some other principal's direction.
   *
   * It is also how the default principal was measured rather than assumed.
   * `registerTools` calls its default context "an empty, all-allowed
   * principal" — and it is NOT all-allowed against a scope-gated tool, because
   * `scopes: undefined` holds nothing. The gate has always refused it; only
   * now does the list agree. That is the fix working, and it IS visible to a
   * consumer who uses scopes without supplying getContext, so it belongs in
   * the release note rather than in a comment.
   */
  it.each([
    ["default (no fields)", {} as Principal],
    ["read-only, no scopes", { readOnly: true } as Principal],
    ["read-only, holds admin", { readOnly: true, scopes: ["admin"] } as Principal],
    ["writer, no scopes", { scopes: [] } as Principal],
    ["writer, holds admin", { scopes: ["admin"] } as Principal],
  ])("AC#2b — list and gate agree for %s", async (_label, principal) => {
    const shown = await listed(principal);
    const client = await connect(principal);

    for (const tool of tools) {
      const r = (await client.callTool({ name: tool.name, arguments: {} })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      const callable = !r.isError;
      expect(
        callable,
        `${tool.name}: listed=${shown.includes(tool.name)} callable=${callable} — ${r.content[0].text}`,
      ).toBe(shown.includes(tool.name));
    }
  });

  it("AC#3 — a principal missing a scope loses THAT tool and keeps the rest", async () => {
    const got = await listed({ scopes: [] });
    // Two assertions, because "the scoped tool is gone" and "the others survive"
    // are two claims and a filter that emptied the list would satisfy only one.
    expect(got).not.toContain("scoped_admin");
    expect(got).toEqual(["read_one", "read_two", "write_one"]);
  });

  it("AC#3b — holding the scope brings the scope-gated tool back", async () => {
    expect(await listed({ scopes: ["admin"] })).toContain("scoped_admin");
  });

  it("both rules apply at once — read-only AND missing scope removes both tools", async () => {
    expect(await listed({ readOnly: true, scopes: [] })).toEqual(["read_one", "read_two"]);
  });

  it("AC#6 — the GATE is unchanged: a hidden tool called by name is still refused", async () => {
    const principal: Principal = { readOnly: true, scopes: [] };

    // It is not in the catalogue …
    expect(await listed(principal)).not.toContain("write_one");

    // … and naming it anyway still fails, with the message it has always given.
    const client = await connect(principal);
    const write = (await client.callTool({ name: "write_one", arguments: {} })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(write.isError).toBe(true);
    expect(write.content[0].text).toBe(
      "Tool 'write_one' requires write access, but this token is read-only.",
    );

    const scoped = (await client.callTool({ name: "scoped_admin", arguments: {} })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(scoped.isError).toBe(true);
    expect(scoped.content[0].text).toBe("Tool 'scoped_admin' requires scope(s): admin.");
  });

  it("AC#4 — the predicate lives in ONE file; no other source re-implements it", () => {
    const dir = join(__dirname, "..", "src");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => f !== "tools.ts")
      .filter((f) => {
        const src = readFileSync(join(dir, f), "utf8");
        // The two halves of "may this principal call this tool", as they are
        // actually written. A second copy of either is the drift this card
        // exists to prevent: the day one changes, the catalogue and the gate
        // disagree — and hiding a tool the gate ALLOWS looks like a missing
        // feature, not like a bug.
        return src.includes("principal.readOnly") || src.includes("!held.includes(");
      });
    expect(offenders).toEqual([]);
  });
});
