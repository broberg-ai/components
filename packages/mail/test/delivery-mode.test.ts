import { describe, expect, it, vi } from "vitest";
import { createMailer, type DeliveryMode } from "../src/index";

/**
 * F005.8 — the boot-time readback.
 *
 * Filed by cms, who do the RIGHT thing (set `live` explicitly) and thereby opt
 * out of the only signal the package had: the creation-time warning fires only
 * when `live` was left undefined. Their gate then hangs on NODE_ENV being
 * exactly "production" inside the running container, and if it ever is not, prod
 * mail quietly stops reaching real recipients with no error and no warning.
 *
 * Measured against 0.4.0 before any of this was written:
 *
 *   node -e 'console.log(Object.keys(createMailer({apiKey:"re_x", live:false})))'
 *     → [ 'send' ]
 *
 * The resolved decision was not readable at all. That is the red these tests
 * were written against.
 */

const okFetch = () =>
  vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })) as unknown as typeof fetch;

const BASE = { from: "noreply@webhouse.dk" };

describe("the four modes, from the config that produces them", () => {
  const cases: Array<[string, Parameters<typeof createMailer>[0], DeliveryMode]> = [
    ["key + live:true", { ...BASE, apiKey: "re_x", live: true }, "live"],
    ["key + live:false", { ...BASE, apiKey: "re_x", live: false }, "allowlist-only"],
    ["key, live UNSET", { ...BASE, apiKey: "re_x" }, "allowlist-only"],
    ["key + disabled", { ...BASE, apiKey: "re_x", disabled: true }, "disabled"],
    ["no key at all", { ...BASE }, "no-key"],
  ];

  it.each(cases)("%s → %s", (_label, config, expected) => {
    expect(createMailer(config).mode).toBe(expected);
  });

  it("live UNSET and live:false resolve to the SAME mode", () => {
    // Both are "you did not opt in", and 0.3.0 deliberately made them
    // equivalent. Pinned so a later refactor cannot split them apart and hand a
    // consumer a fifth state it has no branch for.
    expect(createMailer({ ...BASE, apiKey: "re_x" }).mode).toBe(
      createMailer({ ...BASE, apiKey: "re_x", live: false }).mode,
    );
  });
});

describe("precedence — the states overlap, so the order decides what a consumer is told", () => {
  it("the kill-switch beats the opt-in", () => {
    // send() returns early on `disabled` before the allowlist gate is ever
    // consulted, so reporting 'live' here would describe something that cannot
    // happen.
    expect(createMailer({ ...BASE, apiKey: "re_x", live: true, disabled: true }).mode).toBe("disabled");
  });

  it("A MISSING KEY BEATS live:true — this is the false green the field exists to rule out", () => {
    // THE test of this story. A boolean `live` readback would have let a
    // consumer write `if (isProd && !mailer.live) throw` and have it PASS over a
    // mailer that cannot send at all. One field, carrying the reason, makes that
    // assertion impossible to write wrongly.
    const mailer = createMailer({ ...BASE, live: true });
    expect(mailer.mode).toBe("no-key");
    expect(mailer.mode).not.toBe("live");
  });

  it("disabled with no key still reports disabled, not no-key", () => {
    // Matches send()'s own log, which says "disabled" when both are true.
    expect(createMailer({ ...BASE, disabled: true }).mode).toBe("disabled");
  });
});

describe("mode AGREES WITH BEHAVIOUR — bound to the outcome, not to the config it came from", () => {
  // A readback derived from the same expression it claims to describe is a
  // tautology: it would stay green if send() changed underneath it. So each mode
  // is checked by actually SENDING to a non-allowlisted recipient and observing
  // what happens.
  const configs: Array<[DeliveryMode, Parameters<typeof createMailer>[0]]> = [
    ["live", { ...BASE, apiKey: "re_x", live: true }],
    ["allowlist-only", { ...BASE, apiKey: "re_x", live: false }],
    ["disabled", { ...BASE, apiKey: "re_x", disabled: true }],
    ["no-key", { ...BASE }],
  ];

  it.each(configs)("%s: a stranger is delivered to iff mode === 'live'", async (expected, config) => {
    const f = okFetch();
    const mailer = createMailer({ ...config, fetch: f, logger: () => {} });
    expect(mailer.mode).toBe(expected);

    const res = await mailer.send({
      to: "a-total-stranger@example.com",
      subject: "s",
      html: "<p>h</p>",
    });

    const delivered = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    expect(delivered).toBe(mailer.mode === "live");
    expect(res.skipped ?? false).toBe(mailer.mode !== "live");
  });

  it("an ALLOWLISTED recipient still gets through in allowlist-only — the mode is not a global off-switch", async () => {
    // Negative control. Without it, "allowlist-only means nothing is sent"
    // would satisfy the row above and quietly misdescribe the mode.
    const f = okFetch();
    const mailer = createMailer({
      ...BASE,
      apiKey: "re_x",
      live: false,
      allowlist: ["known@webhouse.dk"],
      fetch: f,
      logger: () => {},
    });
    expect(mailer.mode).toBe("allowlist-only");

    const res = await mailer.send({ to: "known@webhouse.dk", subject: "s", html: "<p>h</p>" });
    expect(res.ok).toBe(true);
    expect(res.skipped ?? false).toBe(false);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});

describe("the readback is additive and inert", () => {
  it("mode is resolved ONCE at creation and does not follow a mutated config", () => {
    // Documented behaviour, pinned: a consumer asserting at boot must get the
    // value the mailer was built with, not whatever the object says later.
    const config = { ...BASE, apiKey: "re_x", live: true };
    const mailer = createMailer(config);
    config.live = false;
    expect(mailer.mode).toBe("live");
  });

  it("send() still returns the same shape — nothing about the result changed", async () => {
    const mailer = createMailer({ ...BASE, apiKey: "re_x", live: true, fetch: okFetch() });
    const res = await mailer.send({ to: "x@y.dk", subject: "s", html: "<p>h</p>" });
    expect(res).toEqual({ ok: true, id: "msg_1" });
  });
});
