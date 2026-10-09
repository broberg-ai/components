import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Dockerfile copies the app's source files one by one. A new local module
// that server.ts imports but the Dockerfile forgets builds fine and crashes on
// boot ("Cannot find module './webmcp-lab'") — discovery was down for ~40 min
// on 2026-10-07 for exactly that. Walk the local import graph from server.ts
// and require a COPY line for every file in it.
const dir = new URL("./", import.meta.url);
const dockerfile = readFileSync(new URL("Dockerfile", dir), "utf8");

function localImports(file: string): string[] {
  const src = readFileSync(new URL(file, dir), "utf8");
  return [...src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+["']\.\/([^"']+)["']/gm)].map(
    (m) => (m[1].endsWith(".ts") ? m[1] : `${m[1]}.ts`),
  );
}

function shippedGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    queue.push(...localImports(f));
  }
  return [...seen].sort();
}

describe("Dockerfile ships every module server.ts needs", () => {
  it("has a COPY for each file in server.ts's local import graph", () => {
    const missing = shippedGraph("server.ts").filter(
      (f) => !dockerfile.includes(`COPY apps/discovery/${f} ./${f}`),
    );
    expect(missing).toEqual([]);
  });

  // F038.25: the build step (RUN bun scripts/<x>.mjs) imports sibling modules too.
  // A new one built locally and failed only in the image build ("Cannot find
  // module './favicon.mjs'") — this walk covers that half of the graph.
  it("has a COPY for every scripts/ module the image's build step imports", () => {
    const repoScripts = new URL("../../scripts/", dir);
    const entries = [...dockerfile.matchAll(/bun scripts\/([\w.-]+\.mjs)/g)].map((m) => m[1]);
    expect(entries.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const src = readFileSync(new URL(f, repoScripts), "utf8");
      queue.push(...[...src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+["']\.\/([^"']+\.mjs)["']/gm)].map((m) => m[1]));
    }
    const missing = [...seen].filter((f) => !dockerfile.includes(`COPY scripts/${f} ./scripts/${f}`));
    expect(missing).toEqual([]);
  });

  it("the walk actually finds the imports (control)", () => {
    expect(shippedGraph("server.ts")).toEqual(
      expect.arrayContaining(["server.ts", "enroll.ts", "speech-dictionary.ts", "webmcp-lab.ts"]),
    );
  });
});
