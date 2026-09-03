import { describe, expect, it } from "vitest";
import { renderShell, __resetLogoWarning } from "../src/index";
import snapshot from "./logo-block.snapshot.json";

const img = (over: Record<string, unknown> = {}) => {
  const html = renderShell({
    subject: "s", accentColor: "#0f7391", bodyHtml: "<p>x</p>",
    logoUrl: "https://x.dk/logo.png", logoAlt: "Mark", ...over,
  } as never);
  return html.match(/<img [^>]*>/)?.[0] ?? "";
};

describe("logoWidth omitted — the negative control (F023.10 AC#1)", () => {
  it("renders byte-identically to 0.4.0", () => {
    // The snapshot was captured from dist/index.js as built at mail-core-v0.4.0,
    // BEFORE logoWidth existed. Regenerating it from the new source would make
    // this compare the new code to itself.
    expect(img()).toBe(snapshot.defaultLogo);
  });

  it("and that historic block genuinely has NO width attribute", () => {
    // Without this the test above passes against a snapshot that already
    // contained the fix, proving nothing about existing consumers.
    expect(snapshot.defaultLogo).not.toContain("width=");
    expect(snapshot.defaultLogo).toContain("max-width:180px");
  });
});

describe("logoWidth supplied (F023.10 AC#0)", () => {
  it("emits an HTML width ATTRIBUTE as well as the style", () => {
    const t = img({ logoWidth: 56 });
    // The attribute is the half Outlook reads; the style is the half everything
    // else reads. Neither alone is sufficient, so assert BOTH.
    expect(t).toContain(`width="56"`);
    expect(t).toContain("width:56px");
    expect(t).not.toContain("max-width:180px");
  });

  it("vn-leker's real case: a 480px mark asked for 56px", () => {
    // The reported symptom was a 480x480 source drawn 180px wide on a 520px
    // card. This is that case, so it cannot recur silently.
    expect(img({ logoWidth: 56 })).toContain(`width="56"`);
  });

  it("emits NO height attribute", () => {
    // A forced square distorts a non-square mark in the one client that honours
    // attributes. width + height:auto, never height="…".
    const t = img({ logoWidth: 56 });
    expect(t).not.toMatch(/\sheight="/);
    expect(t).toContain("height:auto");
  });

  it("ignores a nonsense width rather than emitting it", () => {
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(img({ logoWidth: bad })).toBe(snapshot.defaultLogo);
    }
  });

  it("rounds a fractional width — an attribute takes an integer", () => {
    expect(img({ logoWidth: 56.4 })).toContain(`width="56"`);
  });
});

describe("the unsized-logo warning (F023.10, vn-leker's proposal)", () => {
  const capture = (fn: () => void) => {
    const seen: string[] = [];
    const real = console.warn;
    console.warn = (...a: unknown[]) => void seen.push(a.join(" "));
    try { fn(); } finally { console.warn = real; }
    return seen;
  };

  it("warns when a logo is rendered without logoWidth", () => {
    __resetLogoWarning();
    const seen = capture(() => img());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("logoWidth");
    expect(seen[0]).toContain("Outlook");
  });

  it("does NOT warn when logoWidth is given", () => {
    __resetLogoWarning();
    expect(capture(() => img({ logoWidth: 56 }))).toHaveLength(0);
  });

  it("does NOT warn when there is no logo at all", () => {
    // The warning is about an unsized logo, not about a missing option.
    __resetLogoWarning();
    const seen = capture(() =>
      renderShell({ subject: "s", accentColor: "#0f7391", bodyHtml: "<p>x</p>" } as never));
    expect(seen).toHaveLength(0);
  });

  it("warns ONCE per process, not once per render", () => {
    // A transactional mailer renders in a loop; a warning printed a thousand
    // times is one nobody reads.
    __resetLogoWarning();
    expect(capture(() => { img(); img(); img(); })).toHaveLength(1);
  });

  it("and the reset seam actually re-arms it — otherwise every test above only proves a flag exists", () => {
    __resetLogoWarning();
    expect(capture(() => img())).toHaveLength(1);
    __resetLogoWarning();
    expect(capture(() => img())).toHaveLength(1);
  });

  it("warning or not, the rendered markup is unchanged", () => {
    // It must change no mail. That is the whole reason this is acceptable as a
    // non-breaking step instead of changing the default.
    __resetLogoWarning();
    const a = capture(() => {}) && img();
    __resetLogoWarning();
    const b = img();
    expect(a).toBe(b);
    expect(a).toBe(snapshot.defaultLogo);
  });
});
