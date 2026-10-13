// F100.4 — who is in the document: arrive, move, leave — through the real server.
import { describe, expect, it } from "vitest";
import { createLivesync } from "../src/server";
import { connect } from "../src/client";
import { network, settle } from "./net";

const names = (peers: { state: Record<string, unknown> }[]) => peers.map((p) => (p.state.user as { name: string }).name).sort();

describe("F100.4 — presence", () => {
  it("each editor sees the OTHERS (never itself), their cursor moves, and a closed tab disappears", async () => {
    const server = createLivesync({ insecureNoAuth: true });
    const net = network(server);
    const a = connect({ url: "ws://x/sync/p1", socket: net.factory });
    const b = connect({ url: "ws://x/sync/p1", socket: net.factory });
    a.presence.set({ user: { name: "Anna", color: "a" } });
    b.presence.set({ user: { name: "Bo", color: "b" } });
    await settle();
    expect(names(a.presence.peers())).toStrictEqual(["Bo"]);
    expect(names(b.presence.peers())).toStrictEqual(["Anna"]);

    const seen: unknown[] = [];
    const off = b.presence.onChange((p) => seen.push(p[0]?.state.cursor));
    a.presence.set({ cursor: { x: 10, y: 20 } });
    await settle();
    expect(b.presence.peers()[0]!.state).toStrictEqual({ user: { name: "Anna", color: "a" }, cursor: { x: 10, y: 20 } });
    expect(seen).toContainEqual({ x: 10, y: 20 });
    off();

    a.destroy(); // the tab is closed
    await settle();
    expect(b.presence.peers()).toStrictEqual([]);
    b.destroy();
  });

  it("someone who joins LATER sees who is already there", async () => {
    const server = createLivesync({ insecureNoAuth: true });
    const net = network(server);
    const a = connect({ url: "ws://x/sync/p2", socket: net.factory });
    a.presence.set({ user: { name: "Anna" } });
    await settle();
    const c = connect({ url: "ws://x/sync/p2", socket: net.factory });
    await settle();
    expect(names(c.presence.peers())).toStrictEqual(["Anna"]);
    a.destroy();
    c.destroy();
  });

  it("an editor that has set nothing is not listed as a peer (an empty state is not a person)", async () => {
    const server = createLivesync({ insecureNoAuth: true });
    const net = network(server);
    const a = connect({ url: "ws://x/sync/p3", socket: net.factory });
    const b = connect({ url: "ws://x/sync/p3", socket: net.factory });
    await settle();
    expect(a.presence.peers()).toStrictEqual([]);
    a.destroy();
    b.destroy();
  });
});
