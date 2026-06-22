import { describe, expect, it, vi } from "vitest";
import { createCron, CronError } from "../src/index";

/** A fetch that records each request so tests can assert on what was sent. */
function captureFetch(status = 200, body: unknown = { id: "job_1", name: "x", schedule: "* * * * *", url: "https://x" }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const base = { token: "cj_test" } as const;

describe("createCron.createJob", () => {
  it("POSTs to /api/jobs with Bearer auth, infers protocol, serialises headers to a JSON string", async () => {
    const { f, calls } = captureFetch();
    await createCron({ ...base, fetch: f }).createJob({
      name: "xrt81 push-tick",
      schedule: "*/10 * * * *",
      url: "https://xrt81.com/api/push/tick",
      method: "POST",
      headers: { Authorization: "Bearer secret" },
    });
    expect(calls[0].url).toBe("https://cronjobs.webhouse.net/api/jobs");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer cj_test");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.protocol).toBe("https"); // inferred from the url scheme
    expect(sent.url).toBe("https://xrt81.com/api/push/tick");
    expect(sent.headers).toBe('{"Authorization":"Bearer secret"}'); // object → JSON string
  });

  it("an explicit protocol wins over inference", async () => {
    const { f, calls } = captureFetch();
    await createCron({ ...base, fetch: f }).createJob({
      name: "ws",
      schedule: "* * * * *",
      url: "wss://x.example/feed",
      protocol: "wss",
    });
    expect(JSON.parse(String(calls[0].init.body)).protocol).toBe("wss");
  });
});

describe("createCron — auth + transport guards", () => {
  it("throws CronError when no token is set", async () => {
    const { f } = captureFetch();
    await expect(createCron({ fetch: f, token: undefined }).listJobs()).rejects.toBeInstanceOf(CronError);
  });

  it("baseUrl override is honoured and a trailing slash is stripped", async () => {
    const { f, calls } = captureFetch(200, []);
    await createCron({ ...base, baseUrl: "https://cron.example/", fetch: f }).listJobs();
    expect(calls[0].url).toBe("https://cron.example/api/jobs");
  });
});

describe("createCron.listJobs", () => {
  it("returns a bare array verbatim", async () => {
    const { f } = captureFetch(200, [{ id: "a" }, { id: "b" }]);
    const jobs = await createCron({ ...base, fetch: f }).listJobs();
    expect(jobs.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("unwraps a {jobs:[...]} envelope and forwards filters as query params", async () => {
    const { f, calls } = captureFetch(200, { jobs: [{ id: "a" }] });
    const jobs = await createCron({ ...base, fetch: f }).listJobs({ tag: "push", status: "enabled" });
    expect(jobs).toHaveLength(1);
    expect(calls[0].url).toContain("tag=push");
    expect(calls[0].url).toContain("status=enabled");
  });
});

describe("createCron — lifecycle", () => {
  it("pauseJob PUTs enabled=false; resumeJob PUTs enabled=true", async () => {
    const { f, calls } = captureFetch();
    const cron = createCron({ ...base, fetch: f });
    await cron.pauseJob("job_1");
    await cron.resumeJob("job_1");
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ enabled: false });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ enabled: true });
  });

  it("runJob POSTs to /{id}/run; ids are URL-encoded", async () => {
    const { f, calls } = captureFetch();
    await createCron({ ...base, fetch: f }).runJob("a/b");
    expect(calls[0].url).toBe("https://cronjobs.webhouse.net/api/jobs/a%2Fb/run");
    expect(calls[0].init.method).toBe("POST");
  });
});

describe("createCron — error envelopes (tolerant parse)", () => {
  it("throws CronError carrying the stable {error:{code,message}} shape", async () => {
    const { f } = captureFetch(403, { error: { code: "forbidden", message: "scope mismatch" } });
    await expect(createCron({ ...base, fetch: f }).deleteJob("x")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      message: "scope mismatch",
    });
  });

  it("also handles the legacy {error:string} shape", async () => {
    const { f } = captureFetch(422, { error: "bad schedule" });
    await expect(createCron({ ...base, fetch: f }).createJob({ name: "x", schedule: "nope", url: "https://x" }))
      .rejects.toMatchObject({ status: 422, message: "bad schedule" });
  });
});
