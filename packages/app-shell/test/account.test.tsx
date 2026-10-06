// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F095.3 — AccountPage: the user's own name and picture, edited inside the app.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AccountError,
  AccountPage,
  accountErrorKind,
  checkAvatarFile,
  createFetchAccountAdapter,
  type AccountAdapter,
  type AccountProfile,
} from "../src/preact";

afterEach(cleanup);

const BASE: AccountProfile = {
  sub: "u1",
  name: "Christian Broberg",
  picture: "https://id.broberg.ai/avatars/u1-a.webp",
  email: "cb@example.com",
  account_url: "https://id.broberg.ai/account",
};

function fakeAdapter(over: Partial<AccountAdapter> = {}, start: AccountProfile = BASE) {
  const a = {
    load: vi.fn(async () => ({ ...start })),
    saveName: vi.fn(async (name: string) => ({ ...start, name })),
    uploadAvatar: vi.fn(async (_f: Blob) => ({ ...start, picture: "https://id.broberg.ai/avatars/u1-b.webp" })),
    removeAvatar: vi.fn(async () => ({ ...start, picture: null })),
    ...over,
  };
  return a;
}

const input = () => screen.getByTestId("account-name-input") as HTMLInputElement;
const typeName = (v: string) => fireEvent.input(input(), { target: { value: v } });
const pickFile = (file: File) => {
  const el = screen.getByTestId("account-avatar-file") as HTMLInputElement;
  Object.defineProperty(el, "files", { value: [file], configurable: true });
  fireEvent.change(el);
};
const file = (type: string, size: number) => {
  const f = new File(["x"], "me.img", { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("AccountPage — shows the profile", () => {
  it("renders avatar (picture), name and email from load()", async () => {
    render(<AccountPage lang="da" adapter={fakeAdapter()} />);
    await screen.findByTestId("account-name");
    expect(screen.getByTestId("account-name").textContent).toBe("Christian Broberg");
    expect(screen.getByTestId("account-email").textContent).toBe("cb@example.com");
    const img = screen.getByTestId("account-avatar").querySelector("img")!;
    expect(img.getAttribute("src")).toBe(BASE.picture);
    expect(img.className).toContain("bas-avatar"); // .bas-avatar is border-radius:50%
    expect(input().value).toBe("Christian Broberg");
  });
  it("initials when there is no picture, and no Remove button", async () => {
    render(<AccountPage lang="en" adapter={fakeAdapter({}, { ...BASE, picture: null })} />);
    await screen.findByTestId("account-name");
    expect(screen.getByTestId("account-avatar").textContent).toBe("CB");
    expect(screen.queryByTestId("account-avatar-remove")).toBeNull();
  });
});

describe("AccountPage — save name shows the SERVER's answer", () => {
  it("field and shown name come from the response, not the typed text", async () => {
    const a = fakeAdapter({ saveName: vi.fn(async (n: string) => ({ ...BASE, name: n.trim().replace(/\s+/g, " ") })) });
    render(<AccountPage lang="da" adapter={a} />);
    await screen.findByTestId("account-name");
    typeName("  Ny   Navn  ");
    fireEvent.click(screen.getByTestId("account-name-save"));
    await screen.findByTestId("account-ok");
    expect(a.saveName).toHaveBeenCalledWith("  Ny   Navn  ");
    expect(input().value).toBe("Ny Navn");
    expect(screen.getByTestId("account-name").textContent).toBe("Ny Navn");
    expect(screen.getByTestId("account-ok").textContent).toBe("Gemt");
  });
  it("a server that keeps the OLD name: the field shows the old name, not the typed one", async () => {
    const a = fakeAdapter({ saveName: vi.fn(async () => ({ ...BASE })) });
    render(<AccountPage lang="en" adapter={a} />);
    await screen.findByTestId("account-name");
    typeName("Typed");
    fireEvent.click(screen.getByTestId("account-name-save"));
    await screen.findByTestId("account-ok");
    expect(input().value).toBe("Christian Broberg");
    expect(screen.getByTestId("account-ok").textContent).toBe("Saved");
  });
  it("on error: the error shows, the field keeps the typed text, the shown name is unchanged", async () => {
    const a = fakeAdapter({ saveName: vi.fn(async () => { throw new AccountError(500); }) });
    render(<AccountPage lang="da" adapter={a} />);
    await screen.findByTestId("account-name");
    typeName("Mit nye navn");
    fireEvent.click(screen.getByTestId("account-name-save"));
    const err = await screen.findByTestId("account-error");
    expect(err.textContent).toBe("Kunne ikke gemme. Prøv igen.");
    expect(input().value).toBe("Mit nye navn");
    expect(screen.getByTestId("account-name").textContent).toBe("Christian Broberg");
    expect(screen.queryByTestId("account-ok")).toBeNull();
  });
});

describe("AccountPage — picture", () => {
  it("hidden file input accepts png/jpeg/webp; the custom button opens it", async () => {
    render(<AccountPage lang="da" adapter={fakeAdapter()} />);
    await screen.findByTestId("account-name");
    const el = screen.getByTestId("account-avatar-file") as HTMLInputElement;
    expect(el.type).toBe("file");
    expect(el.hidden).toBe(true);
    expect(el.getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
    const click = vi.spyOn(el, "click");
    fireEvent.click(screen.getByTestId("account-avatar-upload"));
    expect(click).toHaveBeenCalledOnce();
  });
  it("upload: the avatar becomes the picture the server answered with", async () => {
    const a = fakeAdapter();
    render(<AccountPage lang="da" adapter={a} />);
    await screen.findByTestId("account-name");
    const f = file("image/png", 1000);
    pickFile(f);
    await screen.findByTestId("account-ok");
    expect(a.uploadAvatar).toHaveBeenCalledWith(f);
    expect(screen.getByTestId("account-avatar").querySelector("img")!.getAttribute("src")).toBe("https://id.broberg.ai/avatars/u1-b.webp");
    expect(screen.getByTestId("account-ok").textContent).toBe("Billedet er gemt");
  });
  it.each([
    ["over 2 MB", file("image/jpeg", 2 * 1024 * 1024 + 1), "Billedet er for stort — højst 2 MB."],
    ["wrong type", file("image/gif", 10), "Vælg et PNG-, JPEG- eller WebP-billede."],
  ])("%s is refused BEFORE uploading — the adapter is never called", async (_l, f, msg) => {
    const a = fakeAdapter();
    render(<AccountPage lang="da" adapter={a} />);
    await screen.findByTestId("account-name");
    pickFile(f);
    expect((await screen.findByTestId("account-error")).textContent).toBe(msg);
    expect(a.uploadAvatar).not.toHaveBeenCalled();
  });
  it("exactly 2 MB is allowed", () => {
    expect(checkAvatarFile({ type: "image/webp", size: 2 * 1024 * 1024 })).toBeNull();
  });
  it("remove asks inline (no confirm()); cancel does nothing; confirm removes and shows initials", async () => {
    const native = vi.spyOn(window, "confirm");
    const a = fakeAdapter();
    render(<AccountPage lang="en" adapter={a} />);
    await screen.findByTestId("account-name");
    fireEvent.click(screen.getByTestId("account-avatar-remove"));
    expect(screen.getByTestId("account-avatar-remove-confirmation").textContent).toContain("Remove your picture?");
    fireEvent.click(screen.getByTestId("account-avatar-remove-cancel"));
    expect(a.removeAvatar).not.toHaveBeenCalled();
    expect(screen.queryByTestId("account-avatar-remove-confirmation")).toBeNull();
    fireEvent.click(screen.getByTestId("account-avatar-remove"));
    fireEvent.click(screen.getByTestId("account-avatar-remove-confirm"));
    await screen.findByTestId("account-ok");
    expect(a.removeAvatar).toHaveBeenCalledOnce();
    expect(native).not.toHaveBeenCalled();
    expect(screen.getByTestId("account-avatar").querySelector("img")).toBeNull();
    expect(screen.getByTestId("account-avatar").textContent).toBe("CB");
    expect(screen.queryByTestId("account-avatar-remove")).toBeNull();
  });
});

describe("AccountPage — Broberg ID link", () => {
  it("«Sikkerhed i Broberg ID» → account_url in a new tab", async () => {
    render(<AccountPage lang="da" adapter={fakeAdapter()} />);
    const a = (await screen.findByTestId("account-bid-link")) as HTMLAnchorElement;
    expect(a.textContent).toBe("Sikkerhed i Broberg ID");
    expect(a.getAttribute("href")).toBe("https://id.broberg.ai/account");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });
  it("English label", async () => {
    render(<AccountPage lang="en" adapter={fakeAdapter()} />);
    expect((await screen.findByTestId("account-bid-link")).textContent).toBe("Security in Broberg ID");
  });
});

describe("AccountPage — sign in again", () => {
  it.each([
    ["403 insufficient_scope", new AccountError(403, "insufficient_scope")],
    ["401 reauth", new AccountError(401, "reauth")],
    ["401 not signed in", new AccountError(401)],
  ])("%s on save → the reauth line, not a generic error, and the fields go read-only", async (_l, err) => {
    const a = fakeAdapter({ saveName: vi.fn(async () => { throw err; }) });
    render(<AccountPage lang="da" adapter={a} />);
    await screen.findByTestId("account-name");
    typeName("X");
    fireEvent.click(screen.getByTestId("account-name-save"));
    expect((await screen.findByTestId("account-reauth-text")).textContent).toBe("Log ind igen for at rette");
    expect(screen.queryByTestId("account-error")).toBeNull();
    expect(input().readOnly).toBe(true);
    expect((screen.getByTestId("account-name-save") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("account-avatar-upload") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("account-avatar-remove") as HTMLButtonElement).disabled).toBe(true);
  });
  it("English line", async () => {
    const a = fakeAdapter({ uploadAvatar: vi.fn(async () => { throw new AccountError(403, "insufficient_scope"); }) });
    render(<AccountPage lang="en" adapter={a} />);
    await screen.findByTestId("account-name");
    pickFile(file("image/png", 10));
    expect((await screen.findByTestId("account-reauth-text")).textContent).toBe("Sign in again to make changes");
  });
  it("a 403 that is NOT insufficient_scope is a normal error", () => {
    expect(accountErrorKind(new AccountError(403, "forbidden"))).toBe("other");
    expect(accountErrorKind(new Error("x"))).toBe("other");
    expect(accountErrorKind(new AccountError(413))).toBe("tooLarge");
    expect(accountErrorKind(new AccountError(415))).toBe("wrongType");
  });
  it("load failing with 401 reauth shows the reauth line, never the error banner", async () => {
    render(<AccountPage lang="da" adapter={fakeAdapter({ load: vi.fn(async () => { throw new AccountError(401, "reauth"); }) })} />);
    expect((await screen.findByTestId("account-reauth-text")).textContent).toBe("Log ind igen for at rette");
    expect(screen.queryByTestId("account-error")).toBeNull();
  });

  // BID issues no refresh token: ~1 h after login every call answers 401 reauth.
  // «Log ind igen» is a FULL page load to the app's login, back to this page.
  const assignSpy = () => {
    const assign = vi.fn();
    const real = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...real, pathname: real.pathname, search: real.search, assign } });
    return { assign, restore: () => Object.defineProperty(window, "location", { configurable: true, value: real }) };
  };
  it("sign-in action on a 401 at LOAD: default = /auth/login?returnTo=<this page>, no prompt parameter", async () => {
    history.replaceState(null, "", "/settings/account?tab=me");
    const { assign, restore } = assignSpy();
    try {
      render(<AccountPage lang="da" adapter={fakeAdapter({ load: vi.fn(async () => { throw new AccountError(401, "reauth"); }) })} />);
      fireEvent.click(await screen.findByTestId("account-reauth-signin"));
      expect(assign.mock.calls).toEqual([["/auth/login?returnTo=%2Fsettings%2Faccount%3Ftab%3Dme"]]);
    } finally {
      restore();
    }
  });
  it("sign-in action on a 401 at SAVE uses reauthHref when given", async () => {
    const { assign, restore } = assignSpy();
    try {
      const a = fakeAdapter({ saveName: vi.fn(async () => { throw new AccountError(401, "reauth"); }) });
      render(<AccountPage lang="en" adapter={a} reauthHref="/login?next=/me" />);
      await screen.findByTestId("account-name");
      typeName("Y");
      fireEvent.click(screen.getByTestId("account-name-save"));
      expect((await screen.findByTestId("account-reauth-text")).textContent).toBe("Sign in again to make changes");
      expect(screen.queryByTestId("account-error")).toBeNull();
      fireEvent.click(screen.getByTestId("account-reauth-signin"));
      expect(assign.mock.calls).toEqual([["/login?next=/me"]]);
    } finally {
      restore();
    }
  });
});

describe("createFetchAccountAdapter — the default, against @broberg/sso accountRoutes", () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  it("GET /api/account/profile", async () => {
    const f = vi.fn(async () => ok(BASE));
    expect(await createFetchAccountAdapter({ fetch: f as unknown as typeof fetch }).load()).toEqual(BASE);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/account/profile");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.credentials).toBe("same-origin");
  });
  it("POST /api/account/profile {name}", async () => {
    const f = vi.fn(async () => ok({ ...BASE, name: "N" }));
    expect((await createFetchAccountAdapter({ fetch: f as unknown as typeof fetch }).saveName("N")).name).toBe("N");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method, init.body]).toEqual(["/api/account/profile", "POST", JSON.stringify({ name: "N" })]);
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });
  it("POST /api/account/profile/avatar with the raw bytes and their Content-Type", async () => {
    const f = vi.fn(async () => ok(BASE));
    const img = new File(["png"], "a.png", { type: "image/png" });
    await createFetchAccountAdapter({ fetch: f as unknown as typeof fetch }).uploadAvatar(img);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method, init.body]).toEqual(["/api/account/profile/avatar", "POST", img]);
    expect((init.headers as Record<string, string>)["content-type"]).toBe("image/png");
  });
  it("POST /api/account/profile/avatar/remove", async () => {
    const f = vi.fn(async () => ok({ ...BASE, picture: null }));
    expect((await createFetchAccountAdapter({ fetch: f as unknown as typeof fetch }).removeAvatar()).picture).toBeNull();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method, init.body]).toEqual(["/api/account/profile/avatar/remove", "POST", undefined]);
  });
  it("a custom url is honoured", async () => {
    const f = vi.fn(async () => ok(BASE));
    await createFetchAccountAdapter({ url: "/x/acct/", fetch: f as unknown as typeof fetch }).load();
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("/x/acct/profile");
  });
  it("non-2xx THROWS an AccountError with status and code — a failed save never looks saved", async () => {
    const f = vi.fn(async () => ok({ error: "insufficient_scope", scope: "profile:write" }, 403));
    const err = await createFetchAccountAdapter({ fetch: f as unknown as typeof fetch }).saveName("x").catch((e) => e);
    expect(err).toBeInstanceOf(AccountError);
    expect([err.status, err.code]).toEqual([403, "insufficient_scope"]);
    expect(accountErrorKind(err)).toBe("reauth");
  });
  it("a 200 without a profile is an error too", async () => {
    const f = vi.fn(async () => ok({ ok: true }));
    await expect(createFetchAccountAdapter({ fetch: f as unknown as typeof fetch }).load()).rejects.toBeInstanceOf(AccountError);
  });
  it("AccountPage with no adapter uses the default fetch", async () => {
    const f = vi.fn(async () => ok(BASE));
    vi.stubGlobal("fetch", f);
    try {
      render(<AccountPage lang="da" />);
      await screen.findByTestId("account-name");
      expect((f.mock.calls[0] as unknown as [string])[0]).toBe("/api/account/profile");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("AccountPage — layout guard", () => {
  it("at 393 px nothing forces horizontal scroll: rows wrap, the input may shrink", () => {
    const css = readFileSync(join(__dirname, "../css/app-shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === sel).map((m) => m[2]).join(";");
    for (const sel of [".bas-account__row", ".bas-account__who", ".bas-account__confirm"]) expect([sel, /flex-wrap:\s*wrap/.test(rule(sel))]).toEqual([sel, true]);
    expect(rule(".bas-account__input")).toMatch(/min-width:\s*0/);
    expect(rule(".bas-account__input")).toMatch(/max-width:\s*100%/);
    expect(rule(".bas-account")).toMatch(/max-width:\s*560px/);
    expect(rule(".bas-account")).not.toMatch(/(^|;)\s*width:\s*\d+px/);
  });
});

it("every interactive element on the page carries a data-testid", async () => {
  render(<AccountPage lang="da" adapter={fakeAdapter()} />);
  await screen.findByTestId("account-name");
  fireEvent.click(screen.getByTestId("account-avatar-remove"));
  const page = screen.getByTestId("account-page");
  const missing = [...page.querySelectorAll("button, input, a, select, textarea")].filter((el) => !el.getAttribute("data-testid"));
  expect(missing.map((el) => el.outerHTML)).toEqual([]);
});

it("waits for the save — the button is disabled while the request is in flight", async () => {
  let resolve!: (p: AccountProfile) => void;
  const a = fakeAdapter({ saveName: vi.fn(() => new Promise<AccountProfile>((r) => (resolve = r))) });
  render(<AccountPage lang="da" adapter={a} />);
  await screen.findByTestId("account-name");
  typeName("Ny");
  fireEvent.click(screen.getByTestId("account-name-save"));
  await waitFor(() => expect((screen.getByTestId("account-name-save") as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getByTestId("account-name-save").textContent).toBe("Gemmer…");
  resolve({ ...BASE });
  await screen.findByTestId("account-ok");
});

describe("F095.5 — the host hears about a change, and an unchanged name cannot be saved", () => {
  const save = () => screen.getByTestId("account-name-save") as HTMLButtonElement;

  it("«Gem» is disabled on a fresh load and for the same name (trailing space included), enabled once it differs", async () => {
    const a = fakeAdapter();
    render(<AccountPage lang="da" adapter={a} />);
    await screen.findByTestId("account-name");
    expect(save().disabled).toBe(true);
    typeName(`${BASE.name} `);
    expect(save().disabled).toBe(true);
    typeName("Nyt navn");
    expect(save().disabled).toBe(false);
    typeName(BASE.name!);
    expect(save().disabled).toBe(true);
    fireEvent.submit(input().form!);
    expect(a.saveName).not.toHaveBeenCalled();
  });

  it("onProfileChange gets the SERVER's answer after a name save, an upload and a removal — never on load", async () => {
    const seen: AccountProfile[] = [];
    const a = fakeAdapter({ saveName: vi.fn(async (n: string) => ({ ...BASE, name: n.trim() })) });
    render(<AccountPage lang="da" adapter={a} onProfileChange={(p) => seen.push(p)} />);
    await screen.findByTestId("account-name");
    expect(seen).toEqual([]);
    typeName("  Ny Navn  ");
    fireEvent.click(save());
    await screen.findByTestId("account-ok");
    pickFile(file("image/png", 10));
    await waitFor(() => expect(seen.length).toBe(2));
    fireEvent.click(screen.getByTestId("account-avatar-remove"));
    fireEvent.click(screen.getByTestId("account-avatar-remove-confirm"));
    await waitFor(() => expect(seen.length).toBe(3));
    expect(seen.map((p) => [p.name, p.picture])).toEqual([
      ["Ny Navn", BASE.picture],
      [BASE.name, "https://id.broberg.ai/avatars/u1-b.webp"],
      [BASE.name, null],
    ]);
  });

  it("a failed save does NOT call onProfileChange", async () => {
    const seen: AccountProfile[] = [];
    const a = fakeAdapter({ saveName: vi.fn(async () => { throw new AccountError(500); }) });
    render(<AccountPage lang="da" adapter={a} onProfileChange={(p) => seen.push(p)} />);
    await screen.findByTestId("account-name");
    typeName("X");
    fireEvent.click(save());
    await screen.findByTestId("account-error");
    expect(seen).toEqual([]);
  });
});
