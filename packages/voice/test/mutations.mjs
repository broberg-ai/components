#!/usr/bin/env node
// F104.3 — mutation pass for @broberg/voice (two source files).
//
// Each mutation is applied to a COPY of src/index.ts and the suite is run against
// it. The real source is never written to, so an interrupted run cannot leave a
// mutant on disk — the failure mode where a harness kills itself mid-mutation and
// the "restore" never happens.
//
// Every mutation asserts its ANCHOR applied. A substitution that silently matched
// nothing reads exactly like a surviving mutant, and that is the lie this exists
// to not tell.
//
// Mutations must produce DIFFERENT red sets. If two matched, one test would be
// carrying both claims and neither would be pinned on its own.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// F081.1 — announce the mutated tree, and PROVE the restore took.
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const PKG = join(REPO, "packages", "voice");
const SERVER = join(PKG, "src", "server.ts");
const CLIENT = join(PKG, "src", "client.ts");
const originals = { [SERVER]: readFileSync(SERVER, "utf8"), [CLIENT]: readFileSync(CLIENT, "utf8") };

const MUTATIONS = [
  {
    name: "canPublish:false still grants publishing",
    file: SERVER,
    find: "const speak = opts.canPublish !== false;",
    replace: "const speak = true;",
    expect: ["canPublish:false makes a listen-only ticket"],
  },
  {
    name: "a listener still opens the microphone",
    file: CLIENT,
    find: "    if (publish) await room.localParticipant.setMicrophoneEnabled(true, { ...AUDIO_CAPTURE });",
    replace: "    await room.localParticipant.setMicrophoneEnabled(true, { ...AUDIO_CAPTURE });",
    expect: ["publish:false joins as a listener"],
  },
  {
    name: "the ticket may publish any source (camera, screen), not only the microphone",
    file: SERVER,
    find: "    ...(speak ? { canPublishSources: [TrackSource.MICROPHONE] } : {}),\n",
    replace: "",
    expect: ["binds one room, microphone only"],
  },
  {
    name: "default ticket lives an hour, not 10 minutes",
    file: SERVER,
    find: "export const DEFAULT_TTL_SECONDS = 600;",
    replace: "export const DEFAULT_TTL_SECONDS = 3600;",
    expect: ["is valid for 10 minutes by default"],
  },
  {
    name: "no upper bound on ttl",
    file: SERVER,
    find: "ttl <= 0 || ttl > MAX_TTL_SECONDS",
    replace: "ttl <= 0",
    expect: ["refuses a ttl outside"],
  },
  {
    name: "missing credentials fall through to LIVEKIT_* in the environment",
    file: SERVER,
    find: "  if (!apiKey || !apiSecret) {",
    replace: "  if (false) {",
    expect: ["refuses missing credentials"],
  },
  {
    name: "an empty room is signed",
    file: SERVER,
    find: 'if (!opts.room?.trim()) throw',
    replace: 'if (false) throw',
    expect: ["refuses an empty room"],
  },
  {
    name: "a rejected webhook escapes as LiveKit's raw error",
    file: SERVER,
    find: '    throw new VoiceError("invalid_webhook", `webhook rejected: ${(e as Error).message}`);',
    replace: "    throw e;",
    expect: ["refuses a changed body"],
  },
  {
    name: "the room is created without noise suppression / echo cancellation / auto gain",
    file: CLIENT,
    find: "new Room({ audioCaptureDefaults: { ...AUDIO_CAPTURE } })",
    replace: "new Room({})",
    expect: ["opens the microphone with noise suppression"],
  },
  {
    name: "mute leaves the microphone on",
    file: CLIENT,
    find: "async mute() { await room.localParticipant.setMicrophoneEnabled(false); muted = true; }",
    replace: "async mute() { muted = true; }",
    expect: ["mute and unmute"],
  },
  {
    name: "output mute is ignored",
    file: CLIENT,
    find: "p.setVolume(outputMuted ? 0 : (volumes.get(p.identity) ?? 1))",
    replace: "p.setVolume(volumes.get(p.identity) ?? 1)",
    expect: ["output mute silences everyone"],
  },
  {
    name: "a person who joins gets no volume applied",
    file: CLIENT,
    find: "(p: RemoteParticipant) => { applyVolume(p); emitParticipants(); }",
    replace: "() => { emitParticipants(); }",
    expect: ["output mute silences everyone", "setVolume reaches only that person"],
  },
  {
    name: "microphone and speaker are swapped",
    file: CLIENT,
    find: 'switchActiveDevice("audioinput", deviceId)',
    replace: 'switchActiveDevice("audiooutput", deviceId)',
    expect: ["switches microphone and speaker"],
  },
  {
    name: "another person's audio is subscribed but never played",
    file: CLIENT,
    find: "      document.body.appendChild(el);\n",
    replace: "",
    expect: ["plays another person's audio"],
  },
  {
    name: "a join or leave is not reported",
    file: CLIENT,
    find: "[RoomEvent.ParticipantDisconnected, () => emitParticipants()],",
    replace: "[RoomEvent.ParticipantDisconnected, () => {}],",
    expect: ["reports the participant list"],
  },
  {
    name: "speakers are reported as names instead of identities",
    file: CLIENT,
    find: "speakers.map((s) => s.identity)",
    replace: "speakers.map((s) => s.name ?? s.identity)",
    expect: ["reports who is speaking"],
  },
  {
    name: "leave keeps its listeners on the room",
    file: CLIENT,
    find: "      for (const [event, fn] of handlers) room.off(event, fn);\n",
    replace: "",
    expect: ["leave disconnects"],
  },
  {
    name: "a refused microphone leaves the room connected",
    file: CLIENT,
    find: "    await room.disconnect();\n    throw e;",
    replace: "    throw e;",
    expect: ["rejects, disconnects and leaves no listener"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "vcmut-"));
for (const f of Object.keys(originals)) copyFileSync(f, join(backup, f.split("/").pop()));

let uncaught = 0;
const redSets = [];

// BEFORE the first mutation. Written after it, the marker would leave open the
// exact window it exists to close.
writeMarker({ harness: "@broberg/voice test/mutations.mjs", file: SERVER });
try {
  for (const m of MUTATIONS) {
    for (const [f, text] of Object.entries(originals)) writeFileSync(f, text);
    const original = originals[m.file];
    if (!original.includes(m.find)) {
      console.log(`ANCHOR MISSING — ${m.name}\n  the substitution matched nothing, so this mutation was never applied`);
      uncaught++;
      continue;
    }
    const mutated = original.replace(m.find, m.replace);
    if (mutated === original) { console.log(`ANCHOR NO-OP — ${m.name}`); uncaught++; continue; }

    writeFileSync(m.file, mutated);
    let out = "";
    let died = false;
    try {
      execFileSync("pnpm", ["vitest", "run"], { cwd: PKG, stdio: "pipe" });
    } catch (e) {
      out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
      died = true;
    }
    if (!died) {
      console.log(`UNCAUGHT — ${m.name}\n  the suite stayed GREEN with this mutation applied`);
      uncaught++;
      continue;
    }
    // STRIP ANSI FIRST. Under CI vitest keeps colour on (turbo sets FORCE_COLOR),
    // so a failing line arrives as "\u001b[31m×\u001b[39m name" and an anchored
    // /^\s*×/ matches nothing. Measured: this harness reported "2 mutations, 2
    // uncaught" on CI while both mutations had in fact been killed — it could not
    // READ the red it had caused. It failed in the safe direction, which is the
    // only reason it was merely noisy rather than a false all-clear.
    const clean = out.replace(/\u001B\[[0-9;]*m/g, "");
    const red = [...new Set(
      // STRIP THE DURATION (F080.4) — vitest appends "10ms", and the
      // identical-red-set check below compares these strings, so a collision
      // hid behind a millisecond. Measured in @broberg/mail.
      clean.split("\n").filter((l) => /^\s*(×|✕|FAIL)/.test(l)).map((l) => l.trim().replace(/\s+\d+(?:\.\d+)?m?s$/, "")),
    )];

    // "the suite died but I cannot see WHICH test" is a third state, and it must
    // not be reported as "the mutation survived". They are opposite facts.
    if (red.length === 0) {
      console.log(`UNREADABLE — ${m.name}`);
      console.log(`  the suite FAILED (so the mutation was caught) but no failing test line`);
      console.log(`  could be parsed from its output, so this harness cannot say WHICH test`);
      console.log(`  caught it. That is a defect in the harness, not evidence about the code.`);
      console.log(`  last output lines:`);
      clean.split("\n").filter(Boolean).slice(-6).forEach((l) => console.log(`     ${l.trim()}`));
      uncaught++;
      redSets.push(`unreadable:${m.name}`);
      continue;
    }

    const hit = m.expect.every((e) => red.some((l) => l.includes(e)));
    redSets.push(red.join("|"));
    console.log(`${hit ? "killed" : "WRONG RED"} — ${m.name}`);
    red.slice(0, 6).forEach((l) => console.log(`     ${l}`));
    if (!hit) {
      console.log(`     expected all of: ${m.expect.join(" · ")}`);
      uncaught++;
    }
  }
} finally {
  for (const f of Object.keys(originals)) copyFileSync(join(backup, f.split("/").pop()), f);
  // The guard. A restore that FAILED is otherwise indistinguishable from one
  // that was not needed — which is how buddy's harness lost a file on
  // 2026-08-14 with a green run to show for it. Does not return on mismatch.
  for (const [f, text] of Object.entries(originals)) assertRestored({ harness: "@broberg/voice test/mutations.mjs", file: f, expected: text });
  rmSync(backup, { recursive: true, force: true });
  clearMarker();
}

const identical = redSets.length !== new Set(redSets).size;
if (identical) console.log("\nWARNING: two mutations produced IDENTICAL red sets — one test may be carrying both");
console.log(`\n${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets`);
process.exit(uncaught === 0 && !identical ? 0 : 1);
