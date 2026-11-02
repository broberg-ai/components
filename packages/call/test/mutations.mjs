#!/usr/bin/env node
// F104.3 — mutation pass for @broberg/call (two source files).
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
const PKG = join(REPO, "packages", "call");
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
    find: "    ...(speak ? { canPublishSources: sources.map((src) => SOURCE_TO_LIVEKIT[src]) } : {}),\n",
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
    find: "new Room({ audioCaptureDefaults: { ...AUDIO_CAPTURE }, ",
    replace: "new Room({ ",
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
  // F104.7 — camera and screen share.
  {
    name: "the default ticket also allows camera and screen",
    file: SERVER,
    find: '  if (sources === undefined) return ["microphone"];',
    replace: '  if (sources === undefined) return ["microphone", "camera", "screen_share"];',
    expect: ["binds one room, microphone only"],
  },
  {
    name: "a listener ticket with sources is signed instead of refused",
    file: SERVER,
    find: '  if (!speak) throw new VoiceError("invalid_sources"',
    replace: '  if (false) throw new VoiceError("invalid_sources"',
    expect: ["refuses sources on a listen-only ticket"],
  },
  {
    name: "an unknown source is passed through",
    file: SERVER,
    find: "  if (unknown.length) throw",
    replace: "  if (false) throw",
    expect: ["refuses empty or unknown sources"],
  },
  {
    name: "requested sources are ignored and only the microphone is granted",
    file: SERVER,
    find: "  return [...new Set(sources)];",
    replace: '  return ["microphone"];',
    expect: ["sources lets the ticket send camera and screen", "screen only means no microphone"],
  },
  {
    name: "simulcast/adaptive stream/dynacast are not turned on",
    file: CLIENT,
    find: "export const VIDEO_ROOM_OPTIONS = { adaptiveStream: true, dynacast: true, publishDefaults: { simulcast: true } } as const;",
    replace: "export const VIDEO_ROOM_OPTIONS = { adaptiveStream: false, dynacast: false, publishDefaults: { simulcast: false } } as const;",
    expect: ["joins with simulcast, adaptive stream and dynacast on"],
  },
  {
    name: "the browser's own stop-sharing button is not reported",
    file: CLIENT,
    find: "    [RoomEvent.LocalTrackUnpublished, onLocalChange],\n",
    replace: "",
    expect: ["BROWSER's own button is reported"],
  },
  {
    name: "screen share always asks for tab sound",
    file: CLIENT,
    find: "on ? { audio: opts?.audio === true } : undefined",
    replace: "on ? { audio: true } : undefined",
    expect: ["screen share without audio asks for no tab sound"],
  },
  {
    name: "other people's video is dropped instead of reported",
    file: CLIENT,
    find: "        remoteVideos.set(track, { video: videoOf(",
    replace: "        void (track, { video: videoOf(",
    expect: ["gives other people's camera and screen as pictures"],
  },
  {
    name: "a remote picture that goes stays in the list",
    file: CLIENT,
    find: "      if (remoteVideos.delete(track)) {",
    replace: "      if (remoteVideos.has(track)) {",
    expect: ["gives other people's camera and screen as pictures"],
  },
  {
    name: "your own camera is not muted on the page",
    file: CLIENT,
    find: "      if (isLocal) el.muted = true;\n",
    replace: "",
    expect: ["your own is muted"],
  },
  {
    name: "audio-only also stops sound",
    file: CLIENT,
    find: "    if (pub.kind === Track.Kind.Video) pub.setSubscribed(!audioOnly);",
    replace: "    pub.setSubscribed(!audioOnly);",
    expect: ["audio-only stops receiving video but keeps sound"],
  },
  {
    name: "audio-only misses people who publish video later",
    file: CLIENT,
    find: "    [RoomEvent.TrackPublished, (pub: RemoteTrackPublication) => { if (audioOnly) applyAudioOnly(pub); }],\n",
    replace: "",
    expect: ["audio-only also holds back video from people who publish later"],
  },
  {
    name: "remote pictures stay attached after leave",
    file: CLIENT,
    find: "      remoteVideos.forEach((_v, track) => track.detach());\n",
    replace: "",
    expect: ["after leave, no picture or media callback fires"],
  },
  // F104.10 — a turned-off camera is not a picture.
  {
    name: "your own muted camera is still reported as a picture",
    file: CLIENT,
    find: "  if (!pub.track || !source || pub.isMuted) return undefined;",
    replace: "  if (!pub.track || !source) return undefined;",
    expect: ["your own camera leaves onVideos when turned off"],
  },
  {
    name: "someone else's muted camera is still reported as a picture",
    file: CLIENT,
    find: ".filter(({ pub }) => !pub.isMuted)",
    replace: ".filter(() => true)",
    expect: ["someone else's camera leaves onVideos when they mute it", "joins with their camera already muted"],
  },
  {
    name: "a mute does not announce anything",
    file: CLIENT,
    find: "    [RoomEvent.TrackMuted, onLocalChange],\n",
    replace: "",
    expect: ["someone else's camera leaves onVideos when they mute it", "a mute anywhere also re-announces"],
  },
  {
    name: "an unmute does not bring the picture back",
    file: CLIENT,
    find: "    [RoomEvent.TrackUnmuted, onLocalChange],\n",
    replace: "",
    expect: ["comes back when they unmute"],
  },
  {
    name: "a refused microphone leaves the room connected",
    file: CLIENT,
    find: "    await room.disconnect();\n    throw e;",
    replace: "    throw e;",
    expect: ["rejects, disconnects and leaves no listener"],
  },
  {
    name: "a recording starting is not passed on to the participants",
    file: CLIENT,
    find: "      recordingCbs.forEach((cb) => cb(on));",
    replace: "",
    expect: ["tells every participant when the media server starts and stops a recording"],
  },
  {
    name: "the recording ticket is not bound to one room",
    file: SERVER,
    find: "token.addGrant({ room, roomRecord: true });",
    replace: "token.addGrant({ roomRecord: true });",
    expect: ["start: POSTs the room with a ticket", "stop and get address the recording"],
  },
  {
    name: "the recording ticket lives an hour",
    file: SERVER,
    find: "new AccessToken(credentials.apiKey, credentials.apiSecret, { ttl: 300 })",
    replace: "new AccessToken(credentials.apiKey, credentials.apiSecret, { ttl: 3600 })",
    expect: ["the ticket runs out after 5 minutes"],
  },
  {
    name: "a refusal from the recording service is read as a recording",
    file: SERVER,
    find: "  if (!res.ok) throw new VoiceError(\"recording_failed\"",
    replace: "  if (false) throw new VoiceError(\"recording_failed\"",
    expect: ["a refusal from the service is an error"],
  },
  {
    name: "the recording ticket may travel over plain http",
    file: SERVER,
    find: 'if (u.protocol !== "https:" && !(u.protocol === "http:" && local))',
    replace: 'if (false)',
    expect: ["refuses missing credentials, room or service address"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "vcmut-"));
for (const f of Object.keys(originals)) copyFileSync(f, join(backup, f.split("/").pop()));

let uncaught = 0;
const redSets = [];

// BEFORE the first mutation. Written after it, the marker would leave open the
// exact window it exists to close.
writeMarker({ harness: "@broberg/call test/mutations.mjs", file: SERVER });
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
  for (const [f, text] of Object.entries(originals)) assertRestored({ harness: "@broberg/call test/mutations.mjs", file: f, expected: text });
  rmSync(backup, { recursive: true, force: true });
  clearMarker();
}

const identical = redSets.length !== new Set(redSets).size;
if (identical) console.log("\nWARNING: two mutations produced IDENTICAL red sets — one test may be carrying both");
console.log(`\n${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets`);
process.exit(uncaught === 0 && !identical ? 0 : 1);
