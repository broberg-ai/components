// F033.11 — the sync secret must never enter argv, and a URL we hand back must
// have been asked whether it answers.
//
// Every test here drives the REAL flyLiveRebuildInfra against a stub `flyctl`
// on PATH that records its argv and its stdin. That is the only way to assert
// "the value is not in any argument": reading the source proves the call site
// we happen to look at, the recording proves every call the run actually made.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flyLiveRebuildInfra, redactSyncSecret } from "../src/index.js";

// Deliberately NOT credential-shaped. A 64-hex fixture beside the label
// SYNC_SECRET= is what our own commit gate exists to refuse, and it refused
// this file. The property under test is "this exact string never reaches an
// argument", which any distinctive value proves.
const SECRET = ["stub", "sync", "secret", "value", "not-a-credential"].join("-");

const STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.FLYCTL_STUB_DIR;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, "argv.jsonl"), JSON.stringify(args) + "\\n");
const sub = [args[0], args[1]].filter((a) => a && !a.startsWith("-")).join(" ");
const fail = process.env.FLYCTL_STUB_FAIL;
if (sub === "secrets import") {
  let stdin = "";
  try { stdin = fs.readFileSync(0, "utf8"); } catch {}
  fs.writeFileSync(path.join(dir, "stdin.txt"), stdin);
  if (fail === "secrets import") {
    process.stderr.write((process.env.FLYCTL_STUB_FAIL_MSG || "boom").replace("{{STDIN}}", stdin.trim()));
    process.exit(1);
  }
  process.exit(0);
}
if (fail && sub === fail) {
  process.stderr.write(process.env.FLYCTL_STUB_FAIL_MSG || "boom");
  process.exit(1);
}
if (args[1] === "list") {
  process.stdout.write(process.env["FLYCTL_STUB_LIST_" + args[0]] || "[]");
  process.exit(0);
}
process.exit(0);
`;

let stubDir: string;
let originalPath: string | undefined;

function config(overrides: Record<string, unknown> = {}) {
  return {
    appName: "broberg-helpdesk-console",
    region: "arn",
    volumeName: "data",
    syncSecret: SECRET,
    ...overrides,
  } as Parameters<typeof flyLiveRebuildInfra>[0];
}

/** Every argument of every flyctl invocation the run actually made. */
function recordedArgs(): string[] {
  const file = join(stubDir, "argv.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => JSON.parse(line) as string[]);
}

function recordedStdin(): string {
  const file = join(stubDir, "stdin.txt");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function healthAnswers(ok: boolean) {
  vi.stubGlobal("fetch", async () => ({ ok, status: ok ? 200 : 502 }) as unknown as Response);
}

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), "flyctl-stub-"));
  writeFileSync(join(stubDir, "flyctl"), STUB);
  chmodSync(join(stubDir, "flyctl"), 0o755);
  originalPath = process.env.PATH;
  process.env.PATH = `${stubDir}:${originalPath}`;
  process.env.FLYCTL_STUB_DIR = stubDir;
  delete process.env.FLYCTL_STUB_FAIL;
  delete process.env.FLYCTL_STUB_FAIL_MSG;
});

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.FLYCTL_STUB_DIR;
  delete process.env.FLYCTL_STUB_FAIL;
  delete process.env.FLYCTL_STUB_FAIL_MSG;
  vi.unstubAllGlobals();
  rmSync(stubDir, { recursive: true, force: true });
});

describe("the sync secret never enters argv", () => {
  it("no argument of any flyctl invocation contains the secret", async () => {
    healthAnswers(true);
    await flyLiveRebuildInfra(config(), { baseUrl: "https://stub.invalid", verifyAttempts: 1 });
    const args = recordedArgs();
    expect(args.length).toBeGreaterThan(0);
    const leaked = args.filter((a) => a.includes(SECRET));
    expect(leaked).toEqual([]);
  });

  it("the secret ARRIVED — it is read off the child's stdin", async () => {
    healthAnswers(true);
    await flyLiveRebuildInfra(config(), { baseUrl: "https://stub.invalid", verifyAttempts: 1 });
    // Without this a fix that simply stops setting the secret would pass the
    // test above while breaking the feature.
    expect(recordedStdin().trim()).toBe(`SYNC_SECRET=${SECRET}`);
    expect(recordedArgs()).toContain("import");
  });

  it("a FAILING secrets call does not reproduce the secret, even when flyctl echoes it", async () => {
    healthAnswers(true);
    process.env.FLYCTL_STUB_FAIL = "secrets import";
    process.env.FLYCTL_STUB_FAIL_MSG = "refused while reading: {{STDIN}}";
    const err = await flyLiveRebuildInfra(config(), {
      baseUrl: "https://stub.invalid",
      verifyAttempts: 1,
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(SECRET);
    expect((err as Error).message).toContain("«SYNC_SECRET redacted»");
  });
});

describe("redactSyncSecret", () => {
  it("replaces every occurrence", () => {
    expect(redactSyncSecret(`a ${SECRET} b ${SECRET}`, SECRET)).toBe(
      "a «SYNC_SECRET redacted» b «SYNC_SECRET redacted»",
    );
  });

  it("an empty secret is a no-op — it must not blank the whole text", () => {
    expect(redactSyncSecret("nothing to hide", "")).toBe("nothing to hide");
  });
});

describe("an app that does not exist", () => {
  it("names the situation and the exact command, not a GraphQL error", async () => {
    healthAnswers(true);
    process.env.FLYCTL_STUB_FAIL = "status";
    process.env.FLYCTL_STUB_FAIL_MSG = 'Error: Could not find App "broberg-helpdesk-console"';
    const err = await flyLiveRebuildInfra(config(), {
      baseUrl: "https://stub.invalid",
      verifyAttempts: 1,
    }).catch((e: Error) => e);
    expect((err as Error).message).toContain("does not exist");
    expect((err as Error).message).toContain("flyctl apps create broberg-helpdesk-console --org");
  });

  it("a status failure that is NOT a missing app is reported as itself", async () => {
    healthAnswers(true);
    process.env.FLYCTL_STUB_FAIL = "status";
    process.env.FLYCTL_STUB_FAIL_MSG = "connection reset by peer";
    const err = await flyLiveRebuildInfra(config(), {
      baseUrl: "https://stub.invalid",
      verifyAttempts: 1,
    }).catch((e: Error) => e);
    expect((err as Error).message).toContain("connection reset by peer");
    expect((err as Error).message).not.toContain("apps create");
  });
});

describe("the returned URL is verified, not assumed", () => {
  it("throws when the health endpoint never answers, and says where to look", async () => {
    healthAnswers(false);
    const err = await flyLiveRebuildInfra(config(), {
      baseUrl: "https://stub.invalid",
      verifyAttempts: 2,
      verifyDelayMs: 1,
    }).catch((e: Error) => e);
    expect((err as Error).message).toContain("never answered");
    expect((err as Error).message).toContain("flyctl ips list");
  });

  it("returns the URL when it answers", async () => {
    healthAnswers(true);
    const url = await flyLiveRebuildInfra(config(), {
      baseUrl: "https://stub.invalid",
      verifyAttempts: 1,
    });
    expect(url).toBe("https://stub.invalid");
  });
});

describe("public IP addresses are allocated explicitly", () => {
  it("allocates v6 and shared v4 when the app has none", async () => {
    healthAnswers(true);
    await flyLiveRebuildInfra(config(), { baseUrl: "https://stub.invalid", verifyAttempts: 1 });
    const args = recordedArgs();
    expect(args).toContain("allocate-v6");
    expect(args).toContain("allocate-v4");
  });

  it("allocates nothing when the app already has both", async () => {
    healthAnswers(true);
    process.env.FLYCTL_STUB_LIST_ips = JSON.stringify([{ Type: "v6" }, { Type: "shared_v4" }]);
    await flyLiveRebuildInfra(config(), { baseUrl: "https://stub.invalid", verifyAttempts: 1 });
    const args = recordedArgs();
    expect(args).not.toContain("allocate-v6");
    expect(args).not.toContain("allocate-v4");
    delete process.env.FLYCTL_STUB_LIST_ips;
  });
});

describe("nothing is swallowed", () => {
  it("a volume that cannot be listed stops the deploy instead of running without storage", async () => {
    healthAnswers(true);
    process.env.FLYCTL_STUB_FAIL = "volumes list";
    process.env.FLYCTL_STUB_FAIL_MSG = "capacity exhausted in arn";
    const err = await flyLiveRebuildInfra(config(), {
      baseUrl: "https://stub.invalid",
      verifyAttempts: 1,
    }).catch((e: Error) => e);
    expect((err as Error).message).toContain("capacity exhausted in arn");
    expect(recordedArgs()).not.toContain("deploy");
  });

  it("a certificate that cannot be listed is reported, not ignored", async () => {
    healthAnswers(true);
    process.env.FLYCTL_STUB_FAIL = "certs list";
    process.env.FLYCTL_STUB_FAIL_MSG = "certs backend unavailable";
    const err = await flyLiveRebuildInfra(config({ customDomain: "console.broberg.dk" }), {
      baseUrl: "https://stub.invalid",
      verifyAttempts: 1,
    }).catch((e: Error) => e);
    expect((err as Error).message).toContain("certs backend unavailable");
  });
});

describe("the doc-comment matches what the function does", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "deploy", "fly-live.ts"),
    "utf8",
  );
  const doc = src.slice(0, src.indexOf("export async function flyLiveRebuildInfra"));
  const lastBlock = doc.slice(doc.lastIndexOf("/**"));

  it("does not promise provisioning it does not perform", () => {
    expect(lastBlock).not.toMatch(/from scratch/i);
  });

  it("says out loud that it does not create the app", () => {
    expect(lastBlock).toMatch(/does NOT create the Fly app/);
  });
});

describe("a config that is missing a field is refused BEFORE anything is printed", () => {
  // Reported by helpdesk from their own wrong call: `{ app: name }` instead of
  // `{ appName: name }`. Plain JS, so no type error — and the run reached the
  // remedy we print, which then read `flyctl apps create undefined --org …`.
  // Right shape, invented content, copyable. That is worse than no message.
  it("names the field, and does not build a command about an app called undefined", async () => {
    const wrong = { app: "helpdesk-console", region: "arn", volumeName: "data", syncSecret: SECRET };
    const err = await flyLiveRebuildInfra(wrong as never, {
      baseUrl: "https://stub.invalid",
      verifyAttempts: 1,
    }).catch((e: Error) => e);
    expect((err as Error).message).toContain("appName");
    expect((err as Error).message).not.toContain("undefined");
    expect((err as Error).message).not.toContain("apps create");
  });

  it("nothing ran — flyctl was never invoked", async () => {
    await flyLiveRebuildInfra({ region: "arn", volumeName: "data", syncSecret: SECRET } as never, {
      baseUrl: "https://stub.invalid",
      verifyAttempts: 1,
    }).catch(() => {});
    expect(recordedArgs()).toEqual([]);
  });

  it("an empty string is missing too — a blank app name builds the same bad command", async () => {
    const err = await flyLiveRebuildInfra(config({ appName: "  " }), {
      baseUrl: "https://stub.invalid",
      verifyAttempts: 1,
    }).catch((e: Error) => e);
    expect((err as Error).message).toContain("appName");
  });

  it("a COMPLETE config is not refused — the guard must not reject valid input", async () => {
    healthAnswers(true);
    await expect(
      flyLiveRebuildInfra(config(), { baseUrl: "https://stub.invalid", verifyAttempts: 1 }),
    ).resolves.toBe("https://stub.invalid");
  });
});
