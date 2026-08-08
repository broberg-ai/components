/**
 * What does redaction actually cost per log call?
 *
 * Published in the README so a consumer on a hot path decides on a number
 * rather than on a feeling. Run: `npm run bench`.
 */
import { createLogger } from "../dist/index.js";

const N = 50_000;
const sink = () => {}; // exclude I/O — we are measuring the package, not the terminal

const fields = {
  route: "/api/search",
  ms: 12,
  requestId: "01J8Z9ABCDEF0123456789",
  user: { id: 42, tenant: "acme" },
};

function bench(label, log) {
  log.info("warmup", fields); // let the JIT settle
  for (let i = 0; i < 2_000; i++) log.info("warmup", fields);

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) log.info("served request", fields);
  const t1 = process.hrtime.bigint();

  const totalMs = Number(t1 - t0) / 1e6;
  const perCallUs = (totalMs * 1000) / N;
  console.log(
    `${label.padEnd(22)} ${perCallUs.toFixed(2).padStart(7)} µs/call   ` +
      `${Math.round(N / (totalMs / 1000)).toLocaleString().padStart(11)} calls/s`,
  );
  return perCallUs;
}

console.log(`\n${N.toLocaleString()} calls, sink discarded (measuring the package, not stdout)\n`);

const off = bench("redact: false", createLogger({ sink, redact: false }));
const on = bench("redact: true (default)", createLogger({ sink, redact: true }));

const overhead = on - off;
console.log(
  `\noverhead of redaction: ${overhead.toFixed(2)} µs/call ` +
    `(${((overhead / off) * 100).toFixed(0)}% on top of the un-redacted path)\n`,
);
