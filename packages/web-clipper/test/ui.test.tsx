// @vitest-environment happy-dom
// F099.6 — the popup: log in, pick a target (remembered), clip, and say what happened.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, fireEvent, waitFor, screen } from "@testing-library/preact";
import { ClipperPopup, type PopupAuth } from "../src/ui";
import { DestinationError, type Destination, type Session } from "../src/transport";
import type { KeyValueStorage } from "../src/auth";
import type { Clip } from "../src/extract";

const S: Session = { accessToken: "t", sub: "user-1", expiresAt: Date.now() + 60_000 };
const memory = (): KeyValueStorage & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
};
const fakeAuth = (start: Session | null = null): PopupAuth & { logins: number } => {
  let s = start;
  const a = { logins: 0, async login() { a.logins++; s = S; return S; }, async session() { return s; }, async logout() { s = null; } };
  return a;
};
const page: Clip = { url: "https://example.com/", title: "Side", units: [{ kind: "page", content: "# side", position: 0 }] };
const dest = (send: Destination["send"] = async () => {}): Destination & { sent: string[] } => {
  const d = {
    sent: [] as string[], id: "trail", label: "Trail",
    targets: async () => [{ id: "kb-1", label: "Noter", group: "Acme" }, { id: "kb-2", label: "Forskning", group: "Acme" }],
    async send(u: Parameters<Destination["send"]>[0], ctx: Parameters<Destination["send"]>[1]) { d.sent.push(ctx.target.id); await send(u, ctx); },
  };
  return d;
};

afterEach(cleanup);

describe("F099.6 — ClipperPopup", () => {
  it("logged out → log in → targets → clip → «Klippet»", async () => {
    const auth = fakeAuth(); const d = dest();
    render(<ClipperPopup title="Trail" auth={auth} destination={d} getClip={async () => page} storage={memory()} />);
    fireEvent.click(await screen.findByTestId("clipper-login"));
    await screen.findByTestId("clipper-target-button");
    fireEvent.click(screen.getByTestId("clipper-clip"));
    await waitFor(() => expect(screen.getByTestId("clipper-status").textContent).toBe("Klippet"));
    expect(d.sent).toStrictEqual(["kb-1"]);
    expect(auth.logins).toBe(1);
  });

  it("the chosen target is remembered per destination, and used on the next open", async () => {
    const store = memory(); const d = dest();
    const first = render(<ClipperPopup title="Trail" auth={fakeAuth(S)} destination={d} getClip={async () => page} storage={store} />);
    fireEvent.click(await screen.findByTestId("clipper-target-button"));
    fireEvent.click(await screen.findByTestId("clipper-target-option-kb-2"));
    await waitFor(() => expect(store.data.get("broberg-web-clipper:target:trail")).toBe("kb-2"));
    first.unmount();
    render(<ClipperPopup title="Trail" auth={fakeAuth(S)} destination={d} getClip={async () => page} storage={store} />);
    await waitFor(() => expect(screen.getByTestId("clipper-target-button").textContent).toContain("Forskning"));
    fireEvent.click(screen.getByTestId("clipper-clip"));
    await waitFor(() => expect(d.sent).toStrictEqual(["kb-2"]));
  });

  it("the picker works from the keyboard (no native select)", async () => {
    render(<ClipperPopup title="Trail" auth={fakeAuth(S)} destination={dest()} getClip={async () => page} storage={memory()} />);
    const btn = await screen.findByTestId("clipper-target-button");
    expect(document.querySelector("select")).toBeNull();
    fireEvent.keyDown(btn, { key: "ArrowDown" });
    fireEvent.keyDown(btn, { key: "ArrowDown" });
    fireEvent.keyDown(btn, { key: "Enter" });
    await waitFor(() => expect(btn.textContent).toContain("Forskning"));
  });

  it("401 twice → back to the login button with «Log ind igen»", async () => {
    render(<ClipperPopup title="Trail" auth={fakeAuth(S)} destination={dest(async () => { throw new DestinationError(401); })} getClip={async () => page} storage={memory()} />);
    fireEvent.click(await screen.findByTestId("clipper-clip"));
    await screen.findByTestId("clipper-login");
    expect(screen.getByTestId("clipper-status").textContent).toBe("Log ind igen");
  });

  it("the receiver is down → «Kunne ikke nå frem», the user stays logged in", async () => {
    const d = { ...dest(async () => { throw new DestinationError(503); }) };
    render(<ClipperPopup title="Trail" auth={fakeAuth(S)} destination={d} getClip={async () => page} storage={memory()} />);
    fireEvent.click(await screen.findByTestId("clipper-clip"));
    await waitFor(() => expect(screen.getByTestId("clipper-status").textContent).toContain("Kunne ikke nå frem"), { timeout: 8000 });
    expect(screen.getByTestId("clipper-root").dataset.phase).toBe("ready");
  }, 10_000);

  it("consent: nothing is sent until the user switches recording on for that conversation", async () => {
    const chat: Clip = { url: "https://chatgpt.com/c/abc", title: "chat", anchor: "abc", units: [{ kind: "turn", role: "user", content: "hej", position: 0 }] };
    const store = memory(); const d = { ...dest(), requiresConsent: true };
    render(<ClipperPopup title="Jam" auth={fakeAuth(S)} destination={d} getClip={async () => chat} storage={store} />);
    fireEvent.click(await screen.findByTestId("clipper-clip"));
    fireEvent.click(await screen.findByTestId("clipper-consent"));
    await waitFor(() => expect(screen.getByTestId("clipper-status").textContent).toBe("Klippet"));
    expect(d.sent).toHaveLength(1);
    expect(store.data.get("broberg-web-clipper:consent:trail:abc")).toBe(true);
  });

  it("the target list answers 401 and the refresh fails → login button with «Log ind igen», not a raw error", async () => {
    const d = { ...dest(), targets: async () => { throw new DestinationError(401); } };
    const auth = { ...fakeAuth(S), session: async (o?: { refresh?: boolean }) => (o?.refresh ? null : S) };
    render(<ClipperPopup title="Trail" auth={auth} destination={d} getClip={async () => page} storage={memory()} />);
    await screen.findByTestId("clipper-login");
    expect(screen.getByTestId("clipper-status").textContent).toBe("Log ind igen");
  });

  it("every interactive element carries a data-testid", async () => {
    render(<ClipperPopup title="Trail" auth={fakeAuth(S)} destination={dest()} getClip={async () => page} storage={memory()} />);
    fireEvent.click(await screen.findByTestId("clipper-target-button"));
    await screen.findByTestId("clipper-target-list");
    const interactive = [...document.querySelectorAll("button, [role=option], input, a")];
    expect(interactive.length).toBeGreaterThan(3);
    expect(interactive.filter((el) => !el.getAttribute("data-testid"))).toStrictEqual([]);
  });
});
