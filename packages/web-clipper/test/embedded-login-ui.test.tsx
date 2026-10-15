// @vitest-environment happy-dom
// F099.24 — the embedded login screen in the ready popup, driven against the contract-v1 fake BID:
// mail → six-box code (paste fills all) → signed in → the popup loads the targets. The window
// login stays as the fallback for a client BID does not allow to log in here.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, fireEvent, waitFor, screen } from "@testing-library/preact";
import { ClipperPopup } from "../src/ui";
import { createBidAuth } from "../src/auth";
import type { Destination } from "../src/transport";
import type { Clip } from "../src/extract";
import { contractBid, identity, ISS, memory } from "./bid-contract";

const page: Clip = { url: "https://example.com/", title: "Side", units: [{ kind: "page", content: "# side", position: 0 }] };
const dest: Destination = { id: "jam", label: "Jam", targets: async () => [{ id: "org-1", label: "Min org" }], async send() {} };
// F099.24's tests run as a client BID gives NO passkey (F099.26): the classic mail screen, never the window.
const popup = (o: { secondFactor?: ("totp" | "sms")[]; embedded?: boolean; passkey?: boolean } = {}) => {
  const bid = contractBid({ passkey: false, ...o });
  const auth = createBidAuth({ issuer: ISS, clientId: "jam-clipper", identity, storage: memory(), fetchImpl: bid.fetchImpl });
  render(<ClipperPopup title="Jam Clipper" auth={auth} destination={dest} getClip={async () => page} storage={memory()} embeddedLogin />);
  return bid;
};
const type = (testid: string, value: string) => fireEvent.input(screen.getByTestId(testid), { target: { value } });
const paste = (testid: string, text: string) => fireEvent.paste(screen.getByTestId(`${testid}-0`), { clipboardData: { getData: () => text } });

afterEach(cleanup);

describe("F099.24 — embedded login screen", () => {
  it("mail → code (pasted into the six boxes) → signed in → the targets load; no window is opened", async () => {
    const bid = popup();
    await screen.findByTestId("embedded-login-email");
    expect((screen.getByTestId("embedded-login-send-code") as HTMLButtonElement).disabled).toBe(true);
    type("embedded-login-email-input", "anne@eksempel.dk");
    expect((screen.getByTestId("embedded-login-send-code") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("embedded-login-send-code"));
    await screen.findByTestId("embedded-login-code");
    expect(screen.getByTestId("embedded-login-code").textContent).toContain("anne@eksempel.dk");
    paste("embedded-login-code-input", "48 10 72");
    expect([0, 1, 2, 3, 4, 5].map((i) => (screen.getByTestId(`embedded-login-code-input-${i}`) as HTMLInputElement).value).join("")).toBe("481072");
    fireEvent.click(screen.getByTestId("embedded-login-verify"));
    await screen.findByTestId("clipper-target-button");
    expect(screen.getByTestId("clipper-root").getAttribute("data-phase")).toBe("ready");
    expect(bid.log.map((c) => c.path)).toStrictEqual(["/embedded/passkey/start", "/embedded/start", "/embedded/verify", "/oauth2/token"]);
  });

  it("a whole code typed or autofilled into the FIRST box spreads over all six (no maxLength cut) — Lens 15/10", async () => {
    popup();
    await screen.findByTestId("embedded-login-email");
    type("embedded-login-email-input", "anne@eksempel.dk");
    fireEvent.click(screen.getByTestId("embedded-login-send-code"));
    await screen.findByTestId("embedded-login-code");
    expect(screen.getByTestId("embedded-login-code-input-0").hasAttribute("maxlength")).toBe(false);
    type("embedded-login-code-input-0", "481072");
    expect([0, 1, 2, 3, 4, 5].map((i) => (screen.getByTestId(`embedded-login-code-input-${i}`) as HTMLInputElement).value).join("")).toBe("481072");
  });

  it("wrong code: says so in words with attempts left, keeps the step; second factor by SMS when asked", async () => {
    popup({ secondFactor: ["totp", "sms"] });
    await screen.findByTestId("embedded-login-email");
    type("embedded-login-email-input", "anne@eksempel.dk");
    fireEvent.click(screen.getByTestId("embedded-login-send-code"));
    await screen.findByTestId("embedded-login-code");
    paste("embedded-login-code-input", "000000");
    fireEvent.click(screen.getByTestId("embedded-login-verify"));
    await waitFor(() => expect(screen.getByTestId("embedded-login-error").textContent).toBe("Koden passer ikke. Prøv igen, eller få en ny kode. 4 forsøg tilbage."));
    expect(screen.getByTestId("embedded-login-code")).toBeTruthy();
    paste("embedded-login-code-input", "481072");
    fireEvent.click(screen.getByTestId("embedded-login-verify"));
    await screen.findByTestId("embedded-login-2fa");
    fireEvent.click(screen.getByTestId("embedded-login-2fa-sms"));
    await waitFor(() => expect(screen.getByTestId("embedded-login-2fa").textContent).toContain("Vi har sendt en kode på SMS."));
    paste("embedded-login-2fa-input", "777777");
    fireEvent.click(screen.getByTestId("embedded-login-2fa-verify"));
    await screen.findByTestId("clipper-target-button");
  });

  it("five wrong codes: the «Vent lidt» screen with the minutes from BID", async () => {
    popup();
    await screen.findByTestId("embedded-login-email");
    type("embedded-login-email-input", "anne@eksempel.dk");
    fireEvent.click(screen.getByTestId("embedded-login-send-code"));
    await screen.findByTestId("embedded-login-code");
    for (let i = 0; i < 4; i++) {
      paste("embedded-login-code-input", "000000");
      fireEvent.click(screen.getByTestId("embedded-login-verify"));
      await waitFor(() => expect(screen.getByTestId("embedded-login-error").textContent).toContain(`${4 - i} forsøg tilbage`));
    }
    paste("embedded-login-code-input", "000000");
    fireEvent.click(screen.getByTestId("embedded-login-verify"));
    await screen.findByTestId("embedded-login-denied");
    expect(screen.getByTestId("embedded-login-error").textContent).toBe("Der er prøvet for mange koder. Af hensyn til din konto kan du prøve igen om 15 minutter.");
  });

  it("NEGATIVE CONTROL: without embeddedLogin the popup shows the window login button as before, even though the auth offers embedded", async () => {
    const auth = createBidAuth({ issuer: ISS, clientId: "jam-clipper", identity, storage: memory(), fetchImpl: contractBid().fetchImpl });
    render(<ClipperPopup title="Jam Clipper" auth={auth} destination={dest} getClip={async () => page} storage={memory()} />);
    await screen.findByTestId("clipper-login");
    expect(screen.queryByTestId("embedded-login-email")).toBeNull();
  });

  it("NEGATIVE CONTROL: a client BID does not allow here → the popup falls back to the window login button", async () => {
    popup({ embedded: false });
    await screen.findByTestId("embedded-login-email");
    type("embedded-login-email-input", "anne@eksempel.dk");
    fireEvent.click(screen.getByTestId("embedded-login-send-code"));
    await screen.findByTestId("clipper-login");
    expect(screen.queryByTestId("embedded-login-email")).toBeNull();
  });
});

// F099.26 — mockup v2: the popup opens on the passkey (BID's frame), the mail code under «Andre muligheder».
describe("F099.26 — passkey first", () => {
  const withPasskey = (o: { onFallback?: () => void } = {}) => {
    const bid = contractBid();
    const auth = createBidAuth({ issuer: ISS, clientId: "jam-clipper", identity, storage: memory(), fetchImpl: bid.fetchImpl });
    render(<ClipperPopup title="Jam Clipper" auth={auth} destination={dest} getClip={async () => page} storage={memory()} embeddedLogin />);
    return bid;
  };
  const frameSays = (data: object) => window.dispatchEvent(new MessageEvent("message", { data: { type: "bid-embedded-passkey", ...data }, origin: ISS }));

  it("opens on the passkey screen with BID's frame (allow publickey-credentials-get); the frame's ok → signed in → the targets load", async () => {
    const bid = withPasskey();
    const frame = (await screen.findByTestId("embedded-login-passkey-frame")) as HTMLIFrameElement;
    expect(screen.queryByTestId("embedded-login-email")).toBeNull();
    const flowId = [...bid.passkeys.keys()][0]!;
    expect(frame.getAttribute("src")).toBe(`${ISS}/embedded/passkey/frame?flow=${flowId}`);
    expect(frame.getAttribute("allow")).toBe("publickey-credentials-get");
    expect(screen.getByTestId("embedded-login-passkey").textContent).toContain("Med Face ID, fingeraftryk eller din telefon");
    bid.confirmPasskey(flowId);
    frameSays({ flow_id: flowId, ok: true });
    await screen.findByTestId("clipper-target-button");
    expect(bid.log.map((c) => c.path)).toStrictEqual(["/embedded/passkey/start", "/embedded/passkey/complete", "/oauth2/token"]);
  });

  it("no key on this device → says so in words on the passkey screen; «Andre muligheder» → mail → code → signed in", async () => {
    const bid = withPasskey();
    await screen.findByTestId("embedded-login-passkey-frame");
    frameSays({ flow_id: [...bid.passkeys.keys()][0], ok: false, error: "not_found" });
    expect((await screen.findByTestId("embedded-login-error")).textContent).toBe("Der er ingen adgangsnøgle til BID på denne enhed. Få en kode på mail under «Andre muligheder».");
    fireEvent.click(screen.getByTestId("embedded-login-other-options"));
    const form = await screen.findByTestId("embedded-login-email");
    expect(form.querySelector(".bwc-login__title")!.textContent).toBe("Andre muligheder");
    expect(form.textContent).toContain("Få en kode på mail");
    expect(screen.queryByTestId("embedded-login-error")).toBeNull(); // the passkey's error stays on the passkey screen (Lens 15/10)
    type("embedded-login-email-input", "anne@eksempel.dk");
    fireEvent.click(screen.getByTestId("embedded-login-send-code"));
    await screen.findByTestId("embedded-login-code");
    paste("embedded-login-code-input", "481072");
    fireEvent.click(screen.getByTestId("embedded-login-verify"));
    await screen.findByTestId("clipper-target-button");
  });

  it("«← Log ind med adgangsnøgle» goes back to the same frame (no new flow while it is still live)", async () => {
    const bid = withPasskey();
    await screen.findByTestId("embedded-login-passkey-frame");
    fireEvent.click(screen.getByTestId("embedded-login-other-options"));
    await screen.findByTestId("embedded-login-email");
    expect(screen.queryByTestId("embedded-login-passkey-frame")).toBeNull();
    fireEvent.click(screen.getByTestId("embedded-login-back-passkey"));
    await screen.findByTestId("embedded-login-passkey-frame");
    expect(bid.log.filter((c) => c.path === "/embedded/passkey/start").length).toBe(1);
  });

  it("no connection while starting the passkey → «Ingen forbindelse»; «Prøv igen» starts the passkey again (not the mail screen)", async () => {
    const bid = contractBid(); let down = true;
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      if (down && new URL(String(input)).pathname === "/embedded/passkey/start") { down = false; throw new TypeError("Failed to fetch"); }
      return bid.fetchImpl(input as RequestInfo, init);
    }) as typeof fetch;
    const auth = createBidAuth({ issuer: ISS, clientId: "jam-clipper", identity, storage: memory(), fetchImpl });
    render(<ClipperPopup title="Jam Clipper" auth={auth} destination={dest} getClip={async () => page} storage={memory()} embeddedLogin />);
    fireEvent.click(await screen.findByTestId("embedded-login-retry"));
    await screen.findByTestId("embedded-login-passkey-frame");
    expect(screen.queryByTestId("embedded-login-email")).toBeNull();
  });

  it("NEGATIVE CONTROL: a client WITHOUT a passkey at BID gets the classic mail screen — no back link, and never the window", async () => {
    popup(); // passkey: false
    const form = await screen.findByTestId("embedded-login-email");
    expect(form.querySelector(".bwc-login__title")!.textContent).toBe("Log ind for at gemme klip");
    expect(screen.queryByTestId("embedded-login-back-passkey")).toBeNull();
    expect(screen.queryByTestId("embedded-login-passkey-frame")).toBeNull();
    expect(screen.queryByTestId("clipper-login")).toBeNull();
  });
});
