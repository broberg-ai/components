import { describe, it, expect, vi } from "vitest";
import { createBellShell, type Layer } from "../src/shell.js";

const labels = { bell: "Notifications", panel: "Notifications", markAll: "Mark all read", seeAll: "See all", empty: "Nothing yet", close: "Close" };

const make = (over: Partial<Parameters<typeof createBellShell>[0]> = {}) => {
  let count = 3;
  const cleared = ["a", "b"];
  const shell = createBellShell({
    labels,
    countUnseen: vi.fn(async () => count),
    markAllSeen: vi.fn(async () => { count = 0; return cleared; }),
    ...over,
  });
  return shell;
};

const alarm = (focusReturn: unknown): Layer => ({ id: "alarm", modal: true, focusReturn });

describe("one count, however many bells", () => {
  it("two subscribers see the SAME number, and markAllSeen takes BOTH to zero", async () => {
    // xrt81's production bug: the bell was rendered in a mobile topbar AND a
    // desktop bar with the count INSIDE the component, so «mark all read»
    // zeroed one of them and the other sat at 2 with every row read.
    const shell = make();
    const mobile: number[] = [];
    const desktop: number[] = [];
    shell.subscribe((s) => mobile.push(s.count));
    shell.subscribe((s) => desktop.push(s.count));

    await shell.open();
    expect(shell.getState().count).toBe(3);

    await shell.markAllSeen();
    expect(shell.getState().count).toBe(0);
    // Both observers ended on the same number — not "both were notified".
    expect(mobile[mobile.length - 1]).toBe(0);
    expect(desktop[desktop.length - 1]).toBe(0);
    expect(mobile).toEqual(desktop);
  });
});

describe("the layer STACK — a modal does not replace the panel", () => {
  it("pushing a layer leaves the panel underneath", () => {
    const shell = make();
    shell.open();
    shell.pushLayer(alarm("the-row"));
    const ids = shell.getState().layers.map((l) => l.id);
    expect(ids).toEqual(["panel", "alarm"]);
  });

  it("closing the top returns focus to the ROW, not to the bell", () => {
    // The whole point of focusReturn being per-layer: the alarm was opened from
    // a row, so that is where the user was.
    const shell = make();
    shell.open(null, "the-bell");
    shell.pushLayer(alarm("the-row"));
    expect(shell.popLayer()).toBe("the-row");
    expect(shell.getState().layers.map((l) => l.id)).toEqual(["panel"]);
  });

  it("the panel itself cannot be popped — closing is a different verb", () => {
    const shell = make();
    shell.open();
    expect(shell.popLayer()).toBe(null);
    expect(shell.getState().open).toBe(true);
  });
});

describe("Escape is an outcome, not a close", () => {
  it("a non-modal panel closes on Escape", () => {
    const shell = make();
    shell.open();
    expect(shell.escape()).toBe("close");
    expect(shell.getState().open).toBe(false);
  });

  it("a MODAL layer does not close on Escape by default", () => {
    // cardmem's alertdialog exists to REQUIRE acknowledgement. One keypress
    // dismissing an incident alarm with nothing recorded is not an a11y
    // detail — it is whether the alarm means anything.
    const shell = make();
    shell.open();
    shell.pushLayer(alarm("the-row"));
    expect(shell.escape()).toBe("keep");
    expect(shell.getState().layers.map((l) => l.id)).toEqual(["panel", "alarm"]);
  });

  it("a layer can decide for itself, in EITHER direction", () => {
    const shell = make();
    shell.open();
    shell.pushLayer({ ...alarm("r"), onEscape: () => "close" });
    expect(shell.escape()).toBe("close");
    expect(shell.getState().layers.map((l) => l.id)).toEqual(["panel"]);

    // …and a non-modal layer can refuse, so the default is not a rule.
    const s2 = make();
    s2.open();
    s2.getState().layers[0]!.onEscape = () => "keep";
    expect(s2.escape()).toBe("keep");
    expect(s2.getState().open).toBe(true);
  });

  it("one press acts on the INNERMOST layer only", () => {
    const shell = make();
    shell.open();
    shell.pushLayer({ ...alarm("r"), onEscape: () => "close" });
    shell.escape();
    // the panel is still open — one press did one thing
    expect(shell.getState().open).toBe(true);
  });
});

describe("clearedIds is held for the VISIT", () => {
  it("survives a re-read after other state changes", async () => {
    const shell = make();
    await shell.open();
    await shell.markAllSeen();
    expect(shell.getState().clearedIds).toEqual(["a", "b"]);
    await shell.refresh();
    // Re-deriving per render is what loses it: tap one, go back, the other two
    // are gone. The set exists exactly once.
    expect(shell.getState().clearedIds).toEqual(["a", "b"]);
  });

  it("dies with the visit, not with a render", async () => {
    const shell = make();
    await shell.open();
    await shell.markAllSeen();
    shell.close();
    expect(shell.getState().clearedIds).toEqual([]);
  });
});

describe("the anchor is captured at the instant of opening", () => {
  const rect = { top: 10, left: 20, right: 60, bottom: 40, width: 40, height: 30 };

  it("is available while open and gone when closed", async () => {
    const shell = make();
    await shell.open(rect);
    expect(shell.getState().anchor).toEqual(rect);
    shell.close();
    expect(shell.getState().anchor).toBe(null);
  });

  it("a bottom-sheet consumer simply passes none — the shell is not indifferent, it is told", async () => {
    const shell = make();
    await shell.open(null);
    expect(shell.getState().anchor).toBe(null);
    expect(shell.getState().open).toBe(true);
  });
});

describe("no default strings, anywhere", () => {
  it("refuses to construct without labels", () => {
    // The type already forbids it; this is the runtime backstop for a JS
    // consumer. A default would let "no decision" look like "a decision" —
    // which is exactly how a bell shipped Danish text into an English app.
    expect(() => createBellShell({ countUnseen: async () => 0, markAllSeen: async () => [] } as never))
      .toThrow(/labels/);
  });

  it("the source contains no user-facing string of its own", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("../src/shell.ts", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    // The PROPERTY, not a list of known-safe words: a user-facing string is
    // prose, and prose has spaces. Ids, type-union members and module
    // specifiers never do. A hand-maintained allow-list would have to grow
    // every time someone adds a union member, and would eventually be edited
    // instead of the code.
    const strings = [...code.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    const prose = strings.filter((t) => t.includes(" "));
    // The one exception is the constructor's throw — a message for the
    // DEVELOPER who forgot the prop, which never reaches a user's screen.
    const leaked = prose.filter((t) => !t.startsWith("@broberg/notifications/shell:"));
    expect(leaked).toEqual([]);
  });

  it("the scan can SEE prose — negative control", async () => {
    // A regex that matches nothing passes forever. Measured this morning on a
    // sibling package: the hex scan would have been green whatever the file
    // contained.
    const planted = 'const t = "Mark all read";';
    const found = [...planted.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((t) => t.includes(" "));
    expect(found).toEqual(["Mark all read"]);
  });
});

describe("no count is ever ARITHMETIC — it comes from the store", () => {
  it("shows the store's number even when it disagrees with previous minus cleared", async () => {
    // THE DISCRIMINATING FIXTURE. A shell that computed `count - cleared.length`
    // would show 1 here and be wrong, and with any ordinary fixture — where the
    // store happens to agree with the arithmetic — it would look correct
    // forever.
    //
    // The disagreement is not contrived: it is the reason this package exists.
    // Two consumers exclude a user's MUTED kinds from the badge, so "cleared"
    // and "counted" are different sets, and one production user measured
    // raw_unseen=50 against a shown count of 1.
    let storeSays = 3;
    const shell = createBellShell({
      labels,
      countUnseen: async () => storeSays,
      markAllSeen: async () => { storeSays = 7; return ["a", "b"]; },  // ← went UP
    });
    await shell.open();
    expect(shell.getState().count).toBe(3);

    await shell.markAllSeen();
    // 3 - 2 = 1 would be the arithmetic answer. The store says 7.
    expect(shell.getState().count).toBe(7);
  });

  it("refresh() asks again rather than trusting what it last saw", async () => {
    let storeSays = 5;
    const shell = createBellShell({
      labels,
      countUnseen: async () => storeSays,
      markAllSeen: async () => [],
    });
    await shell.open();
    expect(shell.getState().count).toBe(5);
    // Something else in the app cleared rows — a different tab, another device,
    // reading the thing a notification was about.
    storeSays = 0;
    await shell.refresh();
    expect(shell.getState().count).toBe(0);
  });
});
