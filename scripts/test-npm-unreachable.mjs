#!/usr/bin/env node
// F038.19 — "the registry did not answer" is not "the registry answered wrong".
// Proven against a real local HTTP server and a closed port, not a mocked fetch.
//   node scripts/test-npm-unreachable.mjs
import http from "node:http";

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); failures++; }
};
const server = (handler) => new Promise((ok) => { const s = http.createServer(handler).listen(0, "127.0.0.1", () => ok(s)); });

const down = await server((_, res) => { res.writeHead(503); res.end("down"); });
const wrong = await server((req, res) => {
  if (req.url.includes("bodymap")) { res.writeHead(404); return res.end("{}"); }
  res.writeHead(503); res.end("down");
});
const load = async (registry) => {
  process.env.NPM_REGISTRY = registry;
  return import(`./npm-latest.mjs?r=${encodeURIComponent(registry)}`); // fresh module: REGISTRY is read at import
};
const PKGS = ["@broberg/mail", "@broberg/bodymap"];
const rejectsWith = async (p) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection, got a result"); };

console.log("npm-unreachable");

await check("503 from the registry → NpmUnreachableError naming EVERY package not asked", async () => {
  const m = await load(`http://127.0.0.1:${down.address().port}`);
  const e = await rejectsWith(m.fetchLatestReleases(PKGS));
  if (!(e instanceof m.NpmUnreachableError)) throw new Error(`got ${e.name}: ${e.message}`);
  if (JSON.stringify(e.packages) !== JSON.stringify(PKGS) || e.total !== 2) throw new Error(JSON.stringify(e));
});

await check("a closed port (connection refused) → NpmUnreachableError", async () => {
  const m = await load("http://127.0.0.1:9");
  const e = await rejectsWith(m.fetchLatestReleases(PKGS));
  if (!(e instanceof m.NpmUnreachableError)) throw new Error(`got ${e.name}: ${e.message}`);
});

await check("NEGATIVE CONTROL: one WRONG answer (404) among unanswered ones → a plain Error, not 'unreachable'", async () => {
  const m = await load(`http://127.0.0.1:${wrong.address().port}`);
  const e = await rejectsWith(m.fetchLatestReleases(PKGS));
  if (e instanceof m.NpmUnreachableError) throw new Error("a 404 was reported as 'could not ask'");
  if (!/HTTP 404/.test(e.message)) throw new Error(e.message);
});

await check("still a THROW for the builder — an unreachable registry never yields a partial list", async () => {
  const m = await load(`http://127.0.0.1:${down.address().port}`);
  const e = await rejectsWith(m.fetchLatestReleases(PKGS));
  if (!(e instanceof Error)) throw new Error("not an Error");
});

down.close(); wrong.close();
console.log(failures ? `\n${failures} FAILED` : "\nall green");
process.exit(failures ? 1 : 0);
