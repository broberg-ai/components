import { describe, expect, it } from "vitest";
import { chain, diff, idempotencyKey, ROOT, unitFingerprint, verify, type Unit } from "../src/core";

// F099.2 — the fingerprint engine. The four things the epic's AC names:
// only-new, resend without duplicates, chain integrity, branching.
const turn = (position: number, role: string, content: string): Unit => ({ kind: "turn", role, content, position });
const convo = (...pairs: [string, string][]) => pairs.map(([r, c], i) => turn(i, r, c));
const fps = async (units: Unit[]) => (await chain(units)).map((l) => l.chainFp);

describe("F099.2 — unit fingerprint", () => {
  it("is deterministic and changes with role, content, position or kind", async () => {
    const base = turn(0, "user", "Hej");
    const fp = await unitFingerprint(base);
    expect(await unitFingerprint({ ...base })).toBe(fp);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    const variants = [
      { ...base, role: "assistant" },
      { ...base, content: "Hej!" },
      { ...base, position: 1 },
      { ...base, kind: "page" },
    ];
    for (const v of variants) expect(await unitFingerprint(v)).not.toBe(fp);
  });

  it("fields cannot bleed into each other (kind «turn» + role «user» ≠ kind «turnu» + role «ser»)", async () => {
    expect(await unitFingerprint({ kind: "turn", role: "user", content: "x", position: 0 }))
      .not.toBe(await unitFingerprint({ kind: "turnu", role: "ser", content: "x", position: 0 }));
  });
});

describe("F099.2 — the chain", () => {
  it("each link includes the previous: changing turn 0 changes every later chain fp, but not their own fp", async () => {
    const a = await chain(convo(["user", "Hej"], ["assistant", "Hej igen"], ["user", "Tak"]));
    const b = await chain(convo(["user", "Hej!"], ["assistant", "Hej igen"], ["user", "Tak"]));
    expect(b[0]!.fp).not.toBe(a[0]!.fp);
    expect([b[1]!.fp, b[2]!.fp]).toEqual([a[1]!.fp, a[2]!.fp]);
    for (const i of [0, 1, 2]) expect(b[i]!.chainFp).not.toBe(a[i]!.chainFp);
  });

  it("refuses positions that are not 0..n-1 in order", async () => {
    await expect(chain([turn(1, "user", "x")])).rejects.toThrow("unit at index 0 has position 1");
  });
});

describe("F099.2 — send only new", () => {
  const c3 = convo(["user", "Hej"], ["assistant", "Hej igen"], ["user", "Tak"]);

  it("a new clip sends everything", async () => {
    const d = await diff([], c3);
    expect(d.kind).toBe("append");
    if (d.kind === "append") expect([d.from, d.units.length]).toEqual([0, 3]);
  });

  it("after two turns were sent, exactly the third is new", async () => {
    const known = (await fps(c3)).slice(0, 2);
    const d = await diff(known, c3);
    expect(d.kind).toBe("append");
    if (d.kind === "append") {
      expect(d.from).toBe(2);
      expect(d.units).toEqual([c3[2]]);
    }
  });

  it("everything already sent → same, nothing to send", async () => {
    expect(await diff(await fps(c3), c3)).toEqual({ kind: "same" });
  });
});

describe("F099.2 — resend without duplicates", () => {
  it("the same snapshot twice gives the same idempotency keys, and the second diff sends nothing", async () => {
    const c = convo(["user", "Hej"], ["assistant", "Svar"]);
    const first = await diff([], c);
    const second = await diff([], c);
    if (first.kind !== "append" || second.kind !== "append") throw new Error("expected append");
    expect(second.links.map(idempotencyKey)).toEqual(first.links.map(idempotencyKey));
    // What the destination keeps after the first send is exactly these keys:
    expect(await diff(first.links.map(idempotencyKey), c)).toEqual({ kind: "same" });
  });

  it("an interrupted send resumes where it stopped: no unit twice, none lost", async () => {
    const c = convo(["user", "a"], ["assistant", "b"], ["user", "c"], ["assistant", "d"]);
    const all = (await chain(c)).map(idempotencyKey);
    const sentBeforeCrash = all.slice(0, 2);
    const d = await diff(sentBeforeCrash, c);
    if (d.kind !== "append") throw new Error("expected append");
    expect([...sentBeforeCrash, ...d.links.map(idempotencyKey)]).toEqual(all);
  });
});

describe("F099.2 — branches (an earlier unit changed)", () => {
  const sent = convo(["user", "Hvad er 2+2?"], ["assistant", "4"], ["user", "Og 3+3?"], ["assistant", "6"]);

  it("an edited prompt: a new branch from that turn; the old line is not touched", async () => {
    const known = await fps(sent);
    const edited = convo(["user", "Hvad er 2+2?"], ["assistant", "4"], ["user", "Og 5+5?"], ["assistant", "10"]);
    const d = await diff(known, edited);
    expect(d.kind).toBe("branch");
    if (d.kind === "branch") {
      expect(d.forkAt).toBe(2);
      expect(d.parentChainFp).toBe(known[1]);
      expect(d.units.map((u) => u.content)).toEqual(["Og 5+5?", "10"]);
      // the old line is still valid on its own — nothing was overwritten
      expect(await fps(sent)).toEqual(known);
    }
  });

  it("a regenerated answer at the very end is a branch at that turn, not an append", async () => {
    const known = await fps(sent);
    const regen = convo(["user", "Hvad er 2+2?"], ["assistant", "4"], ["user", "Og 3+3?"], ["assistant", "Seks."]);
    const d = await diff(known, regen);
    expect(d.kind).toBe("branch");
    if (d.kind === "branch") expect([d.forkAt, d.units.length]).toEqual([3, 1]);
  });

  it("an edit of the very first turn branches from the root", async () => {
    const d = await diff(await fps(sent), convo(["user", "Hvad er 1+1?"], ["assistant", "2"]));
    expect(d.kind).toBe("branch");
    if (d.kind === "branch") expect([d.forkAt, d.parentChainFp]).toEqual([0, ROOT]);
  });

  it("a clip that only got shorter is not a branch and sends nothing", async () => {
    expect(await diff(await fps(sent), sent.slice(0, 2))).toEqual({ kind: "same" });
  });
});

describe("F099.2 — chain integrity", () => {
  it("an intact chain verifies", async () => {
    const c = convo(["user", "a"], ["assistant", "b"], ["user", "c"]);
    expect(await verify(c, await chain(c))).toBeNull();
  });

  it("a unit tampered with in the middle is found at its position", async () => {
    const c = convo(["user", "a"], ["assistant", "b"], ["user", "c"]);
    const links = await chain(c);
    const tampered = c.map((u) => (u.position === 1 ? { ...u, content: "B" } : u));
    expect(await verify(tampered, links)).toEqual({ position: 1, reason: "fp" });
  });

  it("a stored link whose chain fp was rewritten is caught", async () => {
    const c = convo(["user", "a"], ["assistant", "b"]);
    const links = await chain(c);
    links[1] = { ...links[1]!, chainFp: "0".repeat(64) };
    expect(await verify(c, links)).toEqual({ position: 1, reason: "chain" });
  });
});
