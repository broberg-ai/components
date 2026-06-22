import { describe, expect, it, vi } from "vitest";
import { createCron, CronError } from "../src/index";

/** A fetch whose response is decided per request by `responder`, recording every call. */
function mkFetch(responder: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; method: string; body?: any }[] = [];
  const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const i = init ?? {};
    calls.push({
      url: String(url),
      method: (i.method as string) ?? "GET",
      body: i.body ? JSON.parse(String(i.body)) : undefined,
    });
    const { status = 200, body = {} } = responder(String(url), i);
    const noBody = status === 204 || status === 304; // these statuses can't carry a body
    return new Response(noBody ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const ok = () => ({ body: { id: "job_1", name: "x", schedule: "* * * * *", url: "https://x", enabled: true } });
const base = { token: "cj_test" } as const;

describe("createCron.createJob (upsert)", () => {
  it("POSTs to /api/jobs with Bearer auth, infers protocol, serialises headers, forwards externalId", async () => {
    const { f, calls } = mkFetch(ok);
    await createCron({ ...base, fetch: f }).createJob({
      name: "xrt81 push-tick",
      schedule: "*/10 * * * *",
      url: "https://xrt81.com/api/push/tick",
      method: "POST",
      headers: { Authorization: "Bearer secret" },
      externalId: "xrt81:push-tick",
    });
    expect(calls[0].url).toBe("https://cronjobs.webhouse.net/api/jobs");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body.protocol).toBe("https"); // inferred from the url scheme
    expect(calls[0].body.headers).toBe('{"Authorization":"Bearer secret"}'); // object → JSON string
    expect(calls[0].body.externalId).toBe("xrt81:push-tick");
  });

  it("an explicit protocol wins over inference", async () => {
    const { f, calls } = mkFetch(ok);
    await createCron({ ...base, fetch: f }).createJob({
      name: "ws",
      schedule: "* * * * *",
      url: "wss://x.example/feed",
      protocol: "wss",
    });
    expect(calls[0].body.protocol).toBe("wss");
  });
});

describe("createCron — auth + transport", () => {
  it("throws CronError when no token is set", async () => {
    const { f } = mkFetch(ok);
    await expect(createCron({ fetch: f, token: undefined }).listJobs()).rejects.toBeInstanceOf(CronError);
  });

  it("honours a baseUrl override and strips a trailing slash", async () => {
    const { f, calls } = mkFetch(() => ({ body: [] }));
    await createCron({ ...base, baseUrl: "https://cron.example/", fetch: f }).listJobs();
    expect(calls[0].url).toBe("https://cron.example/api/jobs");
  });
});

describe("createCron.listJobs", () => {
  it("returns the bare array and forwards filters as query params", async () => {
    const { f, calls } = mkFetch(() => ({ body: [{ id: "a" }, { id: "b" }] }));
    const jobs = await createCron({ ...base, fetch: f }).listJobs({ tag: "push", status: "active" });
    expect(jobs.map((j) => j.id)).toEqual(["a", "b"]);
    expect(calls[0].url).toContain("tag=push");
    expect(calls[0].url).toContain("status=active");
  });
});

describe("createCron — run / executions / delete", () => {
  it("runJob POSTs to /{id}/run and returns the Execution; ids are URL-encoded", async () => {
    const { f, calls } = mkFetch(() => ({ body: { id: "exec_1", status: "success" } }));
    const exec = await createCron({ ...base, fetch: f }).runJob("a/b");
    expect(calls[0].url).toBe("https://cronjobs.webhouse.net/api/jobs/a%2Fb/run");
    expect(calls[0].method).toBe("POST");
    expect(exec.id).toBe("exec_1");
  });

  it("getExecutions unwraps the {executions} envelope", async () => {
    const { f } = mkFetch(() => ({ body: { executions: [{ id: "e1" }, { id: "e2" }], total: 2 } }));
    const execs = await createCron({ ...base, fetch: f }).getExecutions("job_1");
    expect(execs.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("deleteJob issues a DELETE", async () => {
    const { f, calls } = mkFetch(() => ({ status: 204, body: {} }));
    await createCron({ ...base, fetch: f }).deleteJob("job_1");
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("createCron — enable/disable", () => {
  it("toggleJob POSTs to /toggle and returns the new enabled state", async () => {
    const { f, calls } = mkFetch(() => ({ body: { enabled: false } }));
    const enabled = await createCron({ ...base, fetch: f }).toggleJob("job_1");
    expect(calls[0].url).toBe("https://cronjobs.webhouse.net/api/jobs/job_1/toggle");
    expect(calls[0].method).toBe("POST");
    expect(enabled).toBe(false);
  });

  it("pauseJob is idempotent — it toggles only when currently enabled", async () => {
    const { f, calls } = mkFetch((url, init) => {
      if (url.endsWith("/toggle")) return { body: { enabled: false } };
      return { body: { id: "job_1", enabled: true } }; // getJob: currently enabled
    });
    const r = await createCron({ ...base, fetch: f }).pauseJob("job_1");
    expect(r).toBe(false);
    expect(calls.map((c) => `${c.method} ${c.url.split("/api/jobs/")[1]}`)).toEqual(["GET job_1", "POST job_1/toggle"]);
  });

  it("pauseJob no-ops (no toggle) when the job is already disabled", async () => {
    const { f, calls } = mkFetch(() => ({ body: { id: "job_1", enabled: false } }));
    const r = await createCron({ ...base, fetch: f }).pauseJob("job_1");
    expect(r).toBe(false);
    expect(calls).toHaveLength(1); // GET only — no toggle
    expect(calls[0].method).toBe("GET");
  });
});

describe("createCron.mintKey", () => {
  it("POSTs {name,scope} to /api/keys and returns the one-time key", async () => {
    const { f, calls } = mkFetch(() => ({
      status: 201,
      body: { id: "k1", name: "xrt81 prod", scope: "xrt81", preview: "cj_abc…", enabled: true, key: "cj_abc123" },
    }));
    const minted = await createCron({ ...base, fetch: f }).mintKey({ name: "xrt81 prod", scope: "xrt81" });
    expect(calls[0].url).toBe("https://cronjobs.webhouse.net/api/keys");
    expect(calls[0].body).toEqual({ name: "xrt81 prod", scope: "xrt81" });
    expect(minted.key).toBe("cj_abc123");
  });
});

describe("createCron — errors", () => {
  it("throws CronError carrying the {error:{code,message}} envelope", async () => {
    const { f } = mkFetch(() => ({ status: 403, body: { error: { code: "forbidden", message: "scope mismatch" } } }));
    await expect(createCron({ ...base, fetch: f }).deleteJob("x")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      message: "scope mismatch",
    });
  });

  it("falls back to cron_http_<status> on a non-envelope body (e.g. a proxy 502)", async () => {
    const { f } = mkFetch(() => ({ status: 502, body: "<html>bad gateway</html>" }));
    await expect(createCron({ ...base, fetch: f }).listJobs()).rejects.toMatchObject({
      status: 502,
      message: "cron_http_502",
    });
  });
});
