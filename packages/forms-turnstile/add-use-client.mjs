// Put "use client" on the React adapter's bundles — and ONLY those.
//
// The directive is in src/react.ts, and esbuild strips it: measured on the
// 0.2.0 build, dist/react.js began with the import line. Without it, a Next.js
// app that imports this hook from a component it has not marked itself gets a
// build error pointing into React internals rather than at this package.
//
// It must NOT go on server.js or hono.js. A "use client" directive on the Hono
// middleware would be actively wrong, which is why tsup's global `banner` is not
// the tool here — it applies to every entry. This does the two files it should
// and then PROVES the other bundles are untouched, because "I added it to the
// right file" and "I added it to every file" produce identical console output.
import { readFileSync, writeFileSync } from "node:fs";

const DIRECTIVE = '"use client";\n';
const TARGETS = ["dist/react.js", "dist/react.cjs"];
const MUST_NOT_HAVE = ["dist/server.js", "dist/server.cjs", "dist/hono.js", "dist/hono.cjs"];

for (const file of TARGETS) {
  const src = readFileSync(file, "utf8");
  if (src.startsWith('"use client"') || src.startsWith("'use client'")) continue;
  writeFileSync(file, DIRECTIVE + src);
}

const missing = TARGETS.filter((f) => !readFileSync(f, "utf8").startsWith('"use client"'));
if (missing.length) {
  console.error(`✗ "use client" is missing from: ${missing.join(", ")}`);
  process.exit(1);
}

const contaminated = MUST_NOT_HAVE.filter((f) => readFileSync(f, "utf8").includes("use client"));
if (contaminated.length) {
  console.error(`✗ "use client" leaked into server-side bundles: ${contaminated.join(", ")}`);
  process.exit(1);
}

console.log(`✔ "use client" on ${TARGETS.length} React bundle(s); ${MUST_NOT_HAVE.length} server bundle(s) clean`);
