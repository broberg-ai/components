// The EACCES hint on the Fly socket: a non-root container cannot open the
// root-owned /.fly/api, and the error must name the fix, not only the symptom.
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

function fakeRequest(code: string, message: string) {
  return () => {
    const req = new EventEmitter() as EventEmitter & { end: (b?: unknown) => void };
    req.end = () => {
      const err = Object.assign(new Error(message), { code });
      queueMicrotask(() => req.emit("error", err));
    };
    return req;
  };
}

describe("flyOidcOverSocket — EACCES names the fix", () => {
  it("EACCES carries the non-root hint and points at the README section", async () => {
    vi.resetModules();
    vi.doMock("node:http", () => ({ request: fakeRequest("EACCES", "connect EACCES /.fly/api") }));
    const { flyOidcOverSocket, TicketUnavailableError } = await import("../src/fetch-ticket.js");
    const err = await flyOidcOverSocket("https://id.broberg.ai").catch((e) => e);
    expect(err).toBeInstanceOf(TicketUnavailableError);
    expect(err.message).toContain("connect EACCES /.fly/api");
    expect(err.message).toContain("non-root");
    expect(err.message).toContain("On Fly, if your container does not run as root");
    vi.doUnmock("node:http");
  });

  it("negative control: another socket error gets NO hint", async () => {
    vi.resetModules();
    vi.doMock("node:http", () => ({ request: fakeRequest("ECONNREFUSED", "connect ECONNREFUSED /.fly/api") }));
    const { flyOidcOverSocket } = await import("../src/fetch-ticket.js");
    const err = await flyOidcOverSocket("https://id.broberg.ai").catch((e) => e);
    expect(err.message).toBe("Fly OIDC socket: connect ECONNREFUSED /.fly/api");
    vi.doUnmock("node:http");
  });
});
