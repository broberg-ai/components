#!/usr/bin/env node
// components F110.11 — does every visible service show the CURRENT legal text from
// legal.broberg.ai? The owner's definition of done for F110 (31 Oct 2026): «Din opgave er
// først 100% færdig … når ALLE vores synlige services anvender dette API til data for de 5
// dokumenter.»
//
//   node scripts/check-legal-pages.mjs [docs/legal/visible-services.json]
//
// For every service × every one of the five documents it fetches the page and requires:
//   1. the page renders from @broberg/legal: an element with data-legal-doc="<doc>";
//   2. data-legal-version equals the version legal.broberg.ai serves NOW;
//   3. every authored paragraph (p / note, no merge field) is on the page VERBATIM under its
//      data-legal-id — hand-written or edited text fails even when the attributes are right.
// A missing route is red, named. Exit 1 if anything is red; exit 2 if legal.broberg.ai itself
// cannot be read (that is not a verdict on any service).

import { readFileSync } from "node:fs";

export const DOCS = ["terms", "privacy", "trust", "dpa", "support"];
export const API = process.env.LEGAL_API_URL ?? "https://legal.broberg.ai";

const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const norm = (s) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** The text inside the element carrying data-legal-id="<id>" (first match), or null. */
export function textOf(html, id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = html.match(new RegExp(`<(\\w+)[^>]*\\bdata-legal-id="${esc}"[^>]*>([\\s\\S]*?)</\\1>`));
  return m ? norm(m[2]) : null;
}

/**
 * Judge one page against the current template. Pure, so it is testable without a network.
 * Returns [] when the page is current and untouched, otherwise one line per problem.
 */
export function judgePage(html, doc, template) {
  const root = html.match(new RegExp(`<[^>]*\\bdata-legal-doc="${doc}"[^>]*>`));
  if (!root) return [`does not render ${doc} from @broberg/legal (no data-legal-doc="${doc}")`];
  const version = root[0].match(/data-legal-version="([^"]*)"/)?.[1];
  const problems = [];
  if (version !== template.version) problems.push(`shows version ${version ?? "(none)"}, legal.broberg.ai serves ${template.version}`);
  for (const s of template.sections) {
    for (const b of s.blocks) {
      if ((b.type !== "p" && b.type !== "note") || b.text.includes("{")) continue;
      const got = textOf(html, b.id);
      if (got === null) problems.push(`paragraph ${b.id} is missing`);
      else if (got !== norm(b.text)) problems.push(`paragraph ${b.id} differs from the authored text`);
    }
  }
  return problems;
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "broberg-legal-check/1 (components F110.11)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const file = process.argv[2] ?? "docs/legal/visible-services.json";
  const services = JSON.parse(readFileSync(file, "utf8"));
  const templates = {};
  try {
    for (const doc of DOCS) templates[doc] = JSON.parse(await fetchText(`${API}/v1/${doc}.da.json`));
  } catch (e) {
    console.error(`legal.broberg.ai could not be read (${e.message}) — no verdict on any service.`);
    process.exit(2);
  }

  let red = 0;
  for (const svc of services) {
    const lines = [];
    for (const doc of DOCS) {
      const url = svc.legalRoutes?.[doc];
      if (!url) { lines.push(`  ✗ ${doc}: no page`); continue; }
      let problems;
      try { problems = judgePage(await fetchText(url), doc, templates[doc]); }
      catch (e) { problems = [`could not be fetched (${e.message})`]; }
      lines.push(problems.length ? `  ✗ ${doc}: ${url}\n      ${problems.slice(0, 5).join("\n      ")}${problems.length > 5 ? `\n      … ${problems.length - 5} more` : ""}` : `  ✓ ${doc}: ${url}`);
    }
    const ok = lines.every((l) => l.startsWith("  ✓"));
    if (!ok) red++;
    console.log(`${ok ? "GREEN" : "RED  "} ${svc.service}${svc.ownerSession ? ` (owner: ${svc.ownerSession})` : ""}`);
    for (const l of lines) console.log(l);
  }
  console.log(`\n${services.length - red}/${services.length} services green · checked ${new Date().toISOString()} against ${API}`);
  process.exit(red ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
