import { describe, it, expect, vi } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { Mailer, MailMessage, MailResult } from "@broberg/mail";
import {
  buildAuthOptions,
  makeMagicLinkSender,
  buildMagicLinkPlugin,
} from "../src/index.js";

/** A fake @broberg/mail Mailer that records the message it was asked to send. */
function fakeMailer() {
  const send = vi.fn(async (_msg: MailMessage): Promise<MailResult> => ({ ok: true, id: "x" }));
  const mailer: Mailer = { send };
  return { mailer, send };
}

describe("magic-link → @broberg/mail wiring", () => {
  it("routes sendMagicLink through the injected mailer with the magic URL", async () => {
    const { mailer, send } = fakeMailer();
    const sender = makeMagicLinkSender({ mailer });
    await sender({
      email: "user@example.com",
      url: "https://app.example/api/auth/magic?token=abc123",
      token: "abc123",
    });
    expect(send).toHaveBeenCalledOnce();
    const msg = send.mock.calls[0][0];
    expect(msg.to).toBe("user@example.com");
    expect(msg.subject).toBeTruthy();
    // The magic URL must reach the body (html and/or text).
    expect(`${msg.html ?? ""}${msg.text ?? ""}`).toContain(
      "https://app.example/api/auth/magic?token=abc123",
    );
  });

  it("uses a custom renderer + from when provided", async () => {
    const { mailer, send } = fakeMailer();
    const sender = makeMagicLinkSender({
      mailer,
      from: "Login <login@example.com>",
      subject: "Log ind",
      render: ({ url }) => ({ html: `<a href="${url}">Klik</a>` }),
    });
    await sender({ email: "a@b.com", url: "https://x/y", token: "t" });
    const msg = send.mock.calls[0][0];
    expect(msg.from).toBe("Login <login@example.com>");
    expect(msg.subject).toBe("Log ind");
    expect(msg.html).toContain("https://x/y");
  });
});

describe("magic-link registration (dark-ship)", () => {
  it("registers the magic-link plugin only when config.magicLink is provided", () => {
    const { mailer } = fakeMailer();
    const mlId = buildMagicLinkPlugin({ mailer }).id;

    const withMl = buildAuthOptions({ database: memoryAdapter({}), magicLink: { mailer } });
    expect(withMl.plugins?.some((p) => p.id === mlId)).toBe(true);

    const withoutMl = buildAuthOptions({ database: memoryAdapter({}) });
    expect(withoutMl.plugins).toBeUndefined();
  });
});
