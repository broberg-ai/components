// F100.4 — two people in one document: who is here (presence), where their
// cursor is, and a shared list where each sees the other's addition live.
// The page MEASURES how long a remote addition took to arrive and shows it
// (livesync-last-remote), so a Lens run can assert «within 1 s» on the real thing.
import "@broberg/theme/css/palettes.css";
import "./app.css";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { initPalette, initTheme } from "@broberg/theme";
import { connect, type Peer, type SyncState } from "@broberg/livesync/client";
import type * as Y from "yjs";

initTheme();
initPalette();

interface Item { id: string; text: string; by: string; at: number }
interface User { name: string; color: string }

// One colour per person, from the theme's named tones — never a raw hex.
const TONES = ["--clay", "--sky-d", "--olive-d", "--slate", "--accent"];
// FNV-1a: a simple multiply-and-add hash put every test name on the same tone (measured: Anna, Bo, Gæst → all --accent).
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
  return h;
};
const toneFor = (name: string) => TONES[fnv(name) % TONES.length]!;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const params = new URLSearchParams(location.search);
const me: User = { name: params.get("name")?.trim() || "Gæst", color: "" };
me.color = toneFor(me.name);
const docId = slug(params.get("doc") ?? "demo") || "demo";

const STATE_TEXT: Record<SyncState, string> = { connecting: "Forbinder…", synced: "Forbundet", offline: "Offline — dine ændringer gemmes og sendes senere", denied: "Ingen adgang" };

function App() {
  const live = useMemo(() => connect({ url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/sync/${docId}` }), []);
  const list = live.doc.getArray<Item>("nodes");
  const [state, setState] = useState<SyncState>(live.state);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [items, setItems] = useState<Item[]>(list.toArray());
  const [draft, setDraft] = useState("");
  const [lastRemote, setLastRemote] = useState<{ text: string; ms: number } | null>(null);

  useEffect(() => {
    live.presence.set({ user: me });
    const offState = live.onState(setState);
    const offPeers = live.presence.onChange(setPeers);
    const onChange = (e: Y.YArrayEvent<Item>) => {
      setItems(list.toArray());
      if (e.transaction.local) return;
      // Someone else's addition just arrived: how long since they made it? (same machine → same clock in a test)
      for (const it of e.changes.delta.flatMap((d) => (d.insert as Item[] | undefined) ?? [])) {
        if (it.by !== me.name) setLastRemote({ text: it.text, ms: Date.now() - it.at });
      }
    };
    list.observe(onChange);
    return () => {
      offState();
      offPeers();
      list.unobserve(onChange);
      live.destroy();
    };
  }, []);

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    list.push([{ id: crypto.randomUUID(), text, by: me.name, at: Date.now() }]);
    setDraft("");
  };
  const users = peers.map((p) => ({ id: p.clientId, user: p.state.user as User | undefined, cursor: p.state.cursor as { x: number; y: number } | undefined })).filter((p) => p.user);

  return (
    <main class="ls" data-testid="livesync-root">
      <header class="ls-head">
        <h1>Fælles dokument <span class="ls-doc">{docId}</span></h1>
        <span class={`ls-state ls-state-${state}`} data-testid="livesync-status" role="status">{STATE_TEXT[state]}</span>
      </header>

      <section class="ls-people" aria-label="Hvem er her" data-testid="livesync-peers">
        <span class="ls-chip ls-me" style={{ "--tone": `var(${me.color})` }} data-testid="livesync-me">{me.name} (dig)</span>
        {users.map((p) => (
          <span key={p.id} class="ls-chip" style={{ "--tone": `var(${p.user!.color})` }} data-testid={`livesync-peer-${slug(p.user!.name)}`}>{p.user!.name}</span>
        ))}
        {users.length === 0 ? <span class="ls-alone">Kun dig her lige nu</span> : null}
      </section>

      <section
        class="ls-board"
        data-testid="livesync-board"
        onPointerMove={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          live.presence.set({ cursor: { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height } });
        }}
        onPointerLeave={() => live.presence.set({ cursor: null })}
      >
        <form class="ls-add" data-testid="livesync-node-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input class="ls-input" value={draft} onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)} placeholder="Skriv en idé" aria-label="Ny idé" data-testid="livesync-node-input" />
          <button class="ls-btn" type="submit" disabled={!draft.trim()} data-testid="livesync-node-add">Tilføj</button>
        </form>
        <ul class="ls-list" data-testid="livesync-nodes">
          {items.map((it) => (
            <li key={it.id} class="ls-item" style={{ "--tone": `var(${toneFor(it.by)})` }} data-testid={`livesync-node-${slug(it.text)}`}>
              <span class="ls-dot" aria-hidden="true" />
              <span class="ls-text">{it.text}</span>
              <span class="ls-by">{it.by}</span>
            </li>
          ))}
          {items.length === 0 ? <li class="ls-empty">Ingen idéer endnu — tilføj den første.</li> : null}
        </ul>
        {users.filter((p) => p.cursor).map((p) => (
          <span key={p.id} class="ls-cursor" style={{ left: `${p.cursor!.x * 100}%`, top: `${p.cursor!.y * 100}%`, "--tone": `var(${p.user!.color})` }} data-testid={`livesync-cursor-${slug(p.user!.name)}`}>
            {p.user!.name}
          </span>
        ))}
      </section>

      <p class="ls-latency" data-testid="livesync-last-remote">
        {lastRemote ? `Seneste ændring fra en anden: «${lastRemote.text}» — ankom efter ${lastRemote.ms} ms` : "Ingen ændringer fra andre endnu"}
      </p>
      <output hidden data-testid="livesync-last-remote-ms">{lastRemote ? String(lastRemote.ms) : ""}</output>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
