// F033.13 — the Fly client, against an injected fetch.
//
// These tests pin OUR behaviour: which failures are retried, what a wait loop
// does with Fly's 408, whether a list can be partial, whether the token can
// leak. What Fly itself answers was measured against the live API (24/9 2026)
// and is reproduced here as fixtures — the live check is test/live/fly-api.live.ts.
import { describe, expect, it } from "vitest";
import { FlyApiError, FlyClient, FlyTimeoutError, exitCodeOf, isRetryableStatus } from "../src/index.js";

const TOKEN = "fly-test-token-SHOULD-NEVER-APPEAR-9f3a";

type Reply = { status: number; body?: unknown } | Error;

/** A fetch that answers from a script and records every call. */
function scripted(replies: Reply[]) {
  const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body as string | undefined, auth: headers?.Authorization });
    const r = replies.shift();
    if (!r) throw new Error("test: fetch called more times than scripted");
    if (r instanceof Error) throw r;
    const text = r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const noSleep = async () => {};
const client = (replies: Reply[]) => {
  const s = scripted(replies);
  return { fly: new FlyClient({ token: TOKEN, fetch: s.impl, sleep: noSleep }), calls: s.calls };
};

describe("retry rule — only what can succeed on a second try", () => {
  for (const status of [401, 403, 404, 422]) {
    it(`a ${status} throws at once, after ONE request`, async () => {
      const { fly, calls } = client([{ status, body: { error: "no" } }, { status: 200, body: [] }]);
      const err = await fly.listMachines("app").catch((e) => e);
      expect(err).toBeInstanceOf(FlyApiError);
      expect(err.status).toBe(status);
      expect(err.method).toBe("GET");
      expect(err.path).toBe("/apps/app/machines");
      expect(calls.length).toBe(1);
    });
  }

  for (const status of [408, 429, 500, 502, 503]) {
    it(`a ${status} is retried and the next answer wins`, async () => {
      const { fly, calls } = client([{ status }, { status: 200, body: [{ id: "m1" }] }]);
      const ms = await fly.listMachines("app");
      expect(ms.map((m) => m.id)).toEqual(["m1"]);
      expect(calls.length).toBe(2);
    });
  }

  it("a network failure is retried", async () => {
    const { fly, calls } = client([new TypeError("fetch failed"), { status: 200, body: [] }]);
    expect(await fly.listMachines("app")).toEqual([]);
    expect(calls.length).toBe(2);
  });

  it("gives up after maxAttempts and throws the last transient failure", async () => {
    const { fly, calls } = client([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 200, body: [] }]);
    const err = await fly.listMachines("app").catch((e) => e);
    expect(err).toBeInstanceOf(FlyApiError);
    expect(err.status).toBe(503);
    expect(calls.length).toBe(3);
  });

  it("isRetryableStatus draws the line where the tests above do", () => {
    expect([401, 403, 404, 409, 422].map(isRetryableStatus)).toEqual([false, false, false, false, false]);
    expect([408, 429, 500, 503].map(isRetryableStatus)).toEqual([true, true, true, true]);
  });
});

describe("a hung connection is a failure, not a wait", () => {
  // A fetch that never answers — it only settles when its signal aborts, which
  // is exactly what a dead TCP connection looks like from here.
  const hanging = () => {
    let calls = 0;
    const impl = ((_url: string, init?: RequestInit) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // no signal: hang forever, as fetch would
        signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
      });
    }) as unknown as typeof fetch;
    return { impl, count: () => calls };
  };

  it("a request that never answers fails after requestTimeoutMs, retried like a network error", async () => {
    const h = hanging();
    const fly = new FlyClient({ token: TOKEN, fetch: h.impl, sleep: noSleep, requestTimeoutMs: 50, maxAttempts: 2 });
    const t0 = Date.now();
    const err = await fly.listMachines("app").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(h.count()).toBe(2);
  }, 5_000);

  it("waitForExit's deadline still fires when every poll hangs", async () => {
    const h = hanging();
    const fly = new FlyClient({ token: TOKEN, fetch: h.impl, sleep: noSleep, requestTimeoutMs: 50, maxAttempts: 1 });
    const err = await fly.waitForExit("app", "m1", { pollMs: 0, maxMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
  }, 5_000);
});

describe("the token never leaves in an error", () => {
  it("a Fly body that echoes the token is redacted — message AND body", async () => {
    const { fly } = client([{ status: 401, body: { error: `bad token ${TOKEN}` } }]);
    const err = (await fly.getMachine("app", "m1").catch((e) => e)) as FlyApiError;
    expect(err).toBeInstanceOf(FlyApiError);
    expect(err.message).not.toContain(TOKEN);
    expect(err.body).not.toContain(TOKEN);
    expect(err.body).toContain("[redacted]");
  });

  it("a network error message that carries the token is redacted too", async () => {
    const { fly } = client([new Error(`connect failed ${TOKEN}`), new Error(`connect failed ${TOKEN}`), new Error(`x ${TOKEN}`)]);
    const err = await fly.listMachines("app").catch((e) => e);
    expect(String(err.message)).not.toContain(TOKEN);
  });

  it("the token is sent as a Bearer header — and only there", async () => {
    const { fly, calls } = client([{ status: 200, body: [] }]);
    await fly.listMachines("app");
    expect(calls[0]!.auth).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.url).not.toContain(TOKEN);
  });
});

describe("waitForExit — the end of a machine, not a guess about it", () => {
  const machine = (state: string, events: unknown[] = []) => ({ status: 200, body: { id: "m1", state, events } });

  it("polls through non-terminal states and reports the exit code", async () => {
    const { fly } = client([
      machine("starting"),
      machine("started"),
      machine("stopped", [{ type: "exit", request: { exit_event: { exit_code: 3 } } }]),
    ]);
    expect(await fly.waitForExit("app", "m1", { pollMs: 0 })).toEqual({ state: "stopped", exitCode: 3 });
  });

  it("a stop with NO exit code is reported as null — never as success", async () => {
    const { fly } = client([machine("stopped", [{ type: "stop" }])]);
    const r = await fly.waitForExit("app", "m1", { pollMs: 0 });
    expect(r.exitCode).toBeNull();
    expect(r.exitCode).not.toBe(0);
  });

  it("a permanent failure throws on the FIRST poll — a wrong token is not a slow build", async () => {
    const { fly, calls } = client([{ status: 401, body: { error: "Authenticate: token validation error" } }]);
    const err = await fly.waitForExit("app", "m1", { pollMs: 0, maxMs: 60_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(FlyApiError);
    expect(err.status).toBe(401);
    expect(calls.length).toBe(1);
  });

  it("a 404 on the FIRST poll throws — a machine never seen is not 'destroyed' (wrong id or wrong token)", async () => {
    const { fly, calls } = client([{ status: 404, body: { error: "machine not found" } }]);
    const err = await fly.waitForExit("app", "m1", { pollMs: 0, maxMs: 60_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(FlyApiError);
    expect(err.status).toBe(404);
    expect(err.message).toMatch(/wrong machine id/);
    expect(err.message).toMatch(/wrong token/);
    expect(calls.length).toBe(1);
  });

  it("a 404 AFTER the machine was seen is destroyed — the auto_destroy path", async () => {
    const { fly } = client([machine("started"), { status: 404, body: { error: "machine not found" } }]);
    expect(await fly.waitForExit("app", "m1", { pollMs: 0 })).toEqual({ state: "destroyed", exitCode: null });
  });

  it("times out with the last state it saw", async () => {
    const { fly } = client(Array.from({ length: 50 }, () => machine("started")));
    const err = await fly.waitForExit("app", "m1", { pollMs: 0, maxMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(FlyTimeoutError);
    expect(err.lastState).toBe("started");
  });
});

describe("waitForState — Fly's 408 means 'not yet'", () => {
  it("keeps asking after a 408 until the state arrives", async () => {
    const { fly, calls } = client([
      { status: 408, body: { error: "deadline_exceeded: machine failed to reach desired state" } },
      { status: 200, body: { ok: true, state: "started" } },
    ]);
    await fly.waitForState("app", "m1", "started", 120);
    expect(calls.length).toBe(2);
    expect(calls[0]!.url).toContain("/wait?state=started&timeout=60");
  });

  it("a 404 throws at once instead of waiting out the clock", async () => {
    // A real pause and a short deadline: if the 404 is ever mistaken for "not
    // yet", this fails as a FlyTimeoutError after ~2 s instead of spinning
    // (with no pause, a mistaken loop exhausted the test worker's memory and
    // the failure could not be read — found by the mutation harness).
    const s = scripted(Array.from({ length: 100 }, () => ({ status: 404, body: { error: "machine not found" } })));
    const fly = new FlyClient({ token: TOKEN, fetch: s.impl, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))) });
    const calls = s.calls;
    const err = await fly.waitForState("app", "m1", "started", 2).catch((e) => e);
    expect(err).toBeInstanceOf(FlyApiError);
    expect(err.status).toBe(404);
    expect(calls.length).toBe(1);
  });
});

describe("listAllApps — complete, or an error; never a quiet part", () => {
  const page = (names: string[], hasNext: boolean, total: number, cursor = "c") => ({
    status: 200,
    body: {
      data: {
        apps: {
          nodes: names.map((name) => ({ name, status: "deployed", hostname: null, organization: { slug: "o" } })),
          totalCount: total,
          pageInfo: { hasNextPage: hasNext, endCursor: hasNext ? cursor : null },
        },
      },
    },
  });

  it("walks every page", async () => {
    const { fly, calls } = client([page(["a", "b"], true, 5, "c1"), page(["c", "d"], true, 5, "c2"), page(["e"], false, 5)]);
    expect((await fly.listAllApps(2)).map((a) => a.name)).toEqual(["a", "b", "c", "d", "e"]);
    expect(calls.length).toBe(3);
    expect(JSON.parse(calls[1]!.body!).variables.after).toBe("c1");
  });

  it("a page that fails throws — it does not return the pages before it", async () => {
    const { fly } = client([page(["a", "b"], true, 4, "c1"), { status: 401 }]);
    await expect(fly.listAllApps(2)).rejects.toBeInstanceOf(FlyApiError);
  });

  it("fewer apps than Fly's own totalCount throws", async () => {
    const { fly } = client([page(["a", "b"], false, 3)]);
    await expect(fly.listAllApps()).rejects.toThrow(/collected 2 apps but Fly reports totalCount 3/);
  });
});

describe("GraphQL — HTTP 200 is not success", () => {
  it("a bad token (200 + UNAUTHORIZED) throws a 401 FlyApiError", async () => {
    const { fly } = client([
      { status: 200, body: { data: null, errors: [{ message: "You must be authenticated to view this.", extensions: { code: "UNAUTHORIZED" } }] } },
    ]);
    const err = await fly.listOrgs().catch((e) => e);
    expect(err).toBeInstanceOf(FlyApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("a GraphQL not-found maps to 404", async () => {
    const { fly } = client([
      { status: 200, body: { data: { app: null }, errors: [{ message: 'Could not find App "x"', extensions: { code: "NOT_FOUND" } }] } },
    ]);
    const err = await fly.setSecrets("x", { A: "1" }).catch((e) => e);
    expect(err.status).toBe(404);
  });

  it("setSecrets sends each secret as a key/value pair against the app's id", async () => {
    const { fly, calls } = client([
      { status: 200, body: { data: { app: { id: "app-id-1" } } } },
      { status: 200, body: { data: { setSecrets: { app: { name: "x" } } } } },
    ]);
    await fly.setSecrets("x", { A: "1", B: "2" });
    const input = JSON.parse(calls[1]!.body!).variables.input;
    expect(input).toEqual({ appId: "app-id-1", secrets: [{ key: "A", value: "1" }, { key: "B", value: "2" }] });
  });
});

describe("request shapes", () => {
  it("getApp and getMachine answer null on 404", async () => {
    const { fly } = client([{ status: 404, body: { error: "app not found" } }, { status: 404, body: { error: "not found" } }]);
    expect(await fly.getApp("nope")).toBeNull();
    expect(await fly.getMachine("app", "nope")).toBeNull();
  });

  it("updateMachine POSTs the whole config to the machine", async () => {
    const { fly, calls } = client([{ status: 200, body: { id: "m1" } }]);
    await fly.updateMachine("app", "m1", { image: "img", guest: { cpu_kind: "shared", cpus: 1, memory_mb: 512 } });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://api.machines.dev/v1/apps/app/machines/m1");
    expect(JSON.parse(calls[0]!.body!).config.guest.memory_mb).toBe(512);
  });

  it("names are URL-encoded", async () => {
    const { fly, calls } = client([{ status: 200, body: { apps: [] } }]);
    await fly.listApps("a b/c");
    expect(calls[0]!.url).toBe("https://api.machines.dev/v1/apps?org_slug=a%20b%2Fc");
  });

  it("a missing token refuses to construct", () => {
    const saved = process.env.FLY_API_TOKEN;
    delete process.env.FLY_API_TOKEN;
    try {
      expect(() => new FlyClient()).toThrow(/missing token/);
    } finally {
      if (saved !== undefined) process.env.FLY_API_TOKEN = saved;
    }
  });
});

describe("exitCodeOf", () => {
  it("reads the exit event, and nothing else", () => {
    expect(exitCodeOf({ events: [{ type: "start" }, { type: "exit", request: { exit_event: { exit_code: 0 } } }] })).toBe(0);
    expect(exitCodeOf({ events: [{ type: "stop" }] })).toBeNull();
    expect(exitCodeOf({})).toBeNull();
  });
});

describe("F033.14 — volumes and Prometheus", () => {
  it("listVolumes GETs the app's volumes and returns Fly's array as-is", async () => {
    const vols = [
      { id: "vol_1", name: "data", state: "created", size_gb: 3, region: "arn" },
      { id: "vol_2", name: "old", state: "destroyed", size_gb: 1, region: "arn" },
    ];
    const { fly, calls } = client([{ status: 200, body: vols }]);
    expect(await fly.listVolumes("my app")).toEqual(vols);
    expect(calls[0].url).toBe("https://api.machines.dev/v1/apps/my%20app/volumes");
    expect(calls[0].auth).toBe(`Bearer ${TOKEN}`);
  });

  it("listVolumes: a 401 throws after ONE request", async () => {
    const { fly, calls } = client([{ status: 401, body: { error: "Authenticate: token validation error" } }]);
    const err = await fly.listVolumes("app").catch((e) => e);
    expect(err).toBeInstanceOf(FlyApiError);
    expect(err.status).toBe(401);
    expect(calls.length).toBe(1);
  });

  const promOk = { status: 200, body: { status: "success", data: { resultType: "vector", result: [{ value: [1, "2"] }] } } };

  it("promQuery sends FlyV1 auth — Fly's Prometheus 401s on Bearer", async () => {
    const { fly, calls } = client([promOk]);
    const d = await fly.promQuery("personal", 'sum(fly_instance_up{app="x"})');
    expect(d).toEqual({ resultType: "vector", result: [{ value: [1, "2"] }] });
    expect(calls[0].auth).toBe(`FlyV1 ${TOKEN}`);
    expect(calls[0].method).toBe("GET");
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe("https://api.fly.io/prometheus/personal/api/v1/query");
    expect(u.searchParams.get("query")).toBe('sum(fly_instance_up{app="x"})');
  });

  it("promQuery does not double the prefix on a token that already carries it", async () => {
    const s = scripted([promOk]);
    const fly = new FlyClient({ token: `FlyV1 ${TOKEN}`, fetch: s.impl, sleep: noSleep });
    await fly.promQuery("personal", "up");
    expect(s.calls[0].auth).toBe(`FlyV1 ${TOKEN}`);
  });

  it("promQuery passes time as unix seconds", async () => {
    const { fly, calls } = client([promOk]);
    await fly.promQuery("personal", "up", { time: new Date(1_700_000_000_000) });
    expect(new URL(calls[0].url).searchParams.get("time")).toBe("1700000000");
  });

  it("promQuery: HTTP 200 with status 'error' throws — even when a data-shaped body came with it", async () => {
    const { fly } = client([{ status: 200, body: { status: "error", errorType: "bad_data", error: "parse error", data: { resultType: "vector", result: [] } } }]);
    const err = await fly.promQuery("personal", "up(").catch((e) => e);
    expect(err).toBeInstanceOf(FlyApiError);
    expect(err.message).toMatch(/parse error/);
  });

  it("promQuery: a 401 throws after ONE request and never carries the token", async () => {
    const { fly, calls } = client([{ status: 401, body: `bad token ${TOKEN}` }]);
    const err = await fly.promQuery("personal", "up").catch((e) => e);
    expect(err).toBeInstanceOf(FlyApiError);
    expect(err.status).toBe(401);
    expect(calls.length).toBe(1);
    expect(err.message).not.toContain(TOKEN);
  });
});
