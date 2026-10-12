// The in-memory network the F100.3 tests dial: each FakeSocket is wired to the
// real server through Livesync.connect(), with delivery deferred so messages
// genuinely interleave. (sync/auth tests carry their own copy of the same.)
import type { Livesync } from "../src/server";
import type { SocketLike } from "../src/client";

export const tick = (ms = 5) => new Promise<void>((r) => setTimeout(r, ms));
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await tick();
}

export function network(server: Livesync) {
  const sockets: FakeSocket[] = [];
  class FakeSocket implements SocketLike {
    binaryType = "arraybuffer";
    readyState = 0;
    onopen: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    handle?: ReturnType<Livesync["connect"]>;
    constructor(url: string) {
      sockets.push(this);
      const docId = url.split("/").pop()!;
      setTimeout(() => {
        this.readyState = 1;
        this.handle = server.connect(docId, {
          send: (data) => setTimeout(() => this.readyState === 1 && this.onmessage?.({ data: data.slice().buffer }), 1),
          close: () => setTimeout(() => this.close(), 2),
        });
        this.onopen?.({});
      }, 1);
    }
    send(data: Uint8Array) {
      const copy = data.slice();
      setTimeout(() => this.readyState === 1 && this.handle?.message(copy), 1);
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.handle?.closed();
      setTimeout(() => this.onclose?.({}), 1);
    }
  }
  return { factory: (url: string) => new FakeSocket(url), sockets };
}

/** A socket that never reaches a server — the browser is offline. */
export const nowhere = (): SocketLike => {
  const s: SocketLike = {
    binaryType: "arraybuffer", readyState: 0, onopen: null, onmessage: null, onerror: null,
    onclose: null, send() {}, close() { s.readyState = 3; setTimeout(() => s.onclose?.({}), 1); },
  };
  setTimeout(() => s.close(), 1);
  return s;
};
