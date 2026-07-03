import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SetiClient } from "./client";
import { FrameAccumulator } from "./frame-accumulator";
import type { SetiKey, SetiStreamState } from "./types";

/**
 * <SetiChat> — the complete mobile-first SET/SETI live chat surface:
 * status header, accumulated screen (FrameAccumulator), nav-keys bar
 * (Esc + lucide arrow/enter glyphs) and a text input with delivery feedback (text is preserved
 * when delivery fails).
 *
 * Self-contained styles, themeable via CSS vars (set them on a parent):
 *   --seti-bg, --seti-panel, --seti-edge, --seti-fg, --seti-dim,
 *   --seti-accent, --seti-warn, --seti-bad, --seti-mono, --seti-radius
 *
 * Every interactive element carries data-testid="seti-chat-*".
 */
export interface SetiChatProps {
  /** The host app's proxy mount, e.g. "/api/seti". Ignored if `client` is given. */
  baseUrl?: string;
  client?: SetiClient;
  edge: string;
  session: string;
  /** Extra class on the root (sizing/layout belongs to the host). */
  class?: string;
  /** Placeholder for the text input. Default: "Skriv til sessionen…" */
  placeholder?: string;
  /**
   * Hide the built-in compose form (text input + Send) while keeping the
   * nav-keys bar. For hosts that supply their own single compose field and
   * only want the screen + nav-keys (e.g. cardmem Chat v2). Cleaner than
   * CSS-hiding `.seti-chat__form` from the outside.
   */
  hideInput?: boolean;
}

const NAV_KEYS: Array<{ key: SetiKey; title: string }> = [
  { key: "Escape", title: "Escape" },
  { key: "Up", title: "Pil op" },
  { key: "Down", title: "Pil ned" },
  { key: "Left", title: "Pil venstre" },
  { key: "Right", title: "Pil højre" },
  { key: "Enter", title: "Enter" },
];

/** Inline lucide glyphs for the nav keys — seti-client stays dependency-free
 *  (6 icons don't justify pulling lucide-preact). Escape has no lucide glyph, so
 *  it falls back to a styled "Esc". stroke=currentColor inherits the button colour. */
const NAV_GLYPHS: Partial<Record<SetiKey, string[]>> = {
  Up: ["m5 12 7-7 7 7", "M12 19V5"],
  Down: ["M12 5v14", "m19 12-7 7-7-7"],
  Left: ["m12 19-7-7 7-7", "M19 12H5"],
  Right: ["M5 12h14", "m12 5 7 7-7 7"],
  Enter: ["M20 4v7a4 4 0 0 1-4 4H4", "m9 10-5 5 5 5"],
};

function NavGlyph({ k }: { k: SetiKey }) {
  const paths = NAV_GLYPHS[k];
  if (!paths) return <span class="seti-chat__navkeys-esc">Esc</span>;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const STYLE_ID = "broberg-seti-chat-style";
const CSS = `
.seti-chat{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--seti-bg,#0b0e14);color:var(--seti-fg,#d7dce5);border:1px solid var(--seti-edge,#1e2430);border-radius:var(--seti-radius,12px);overflow:hidden}
.seti-chat__header{display:flex;align-items:center;gap:.55rem;padding:.6rem .9rem;background:var(--seti-panel,#11151f);border-bottom:1px solid var(--seti-edge,#1e2430);font-size:.82rem}
.seti-chat__dot{width:9px;height:9px;border-radius:50%;background:var(--seti-dim,#8a93a6);transition:background .2s;flex:none}
.seti-chat__dot.is-on{background:var(--seti-accent,#34d399);animation:seti-pulse 2s infinite}
.seti-chat__dot.is-bad{background:var(--seti-bad,#f87171)}
@keyframes seti-pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}70%{box-shadow:0 0 0 7px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}
.seti-chat__meta{color:var(--seti-dim,#8a93a6);font-family:var(--seti-mono,ui-monospace,Menlo,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.seti-chat__screen{flex:1;margin:0;padding:.9rem 1rem;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:var(--seti-mono,ui-monospace,Menlo,monospace);font-size:12.5px;line-height:1.45;-webkit-overflow-scrolling:touch}
.seti-chat__screen.is-empty{color:var(--seti-dim,#8a93a6)}
.seti-chat__navkeys{display:flex;gap:.4rem;padding:.45rem .65rem;background:var(--seti-panel,#11151f);flex-wrap:wrap;border-top:1px solid var(--seti-edge,#1e2430)}
.seti-chat__navkeys button{display:inline-flex;align-items:center;justify-content:center;padding:.45rem .7rem;background:var(--seti-edge,#1e2430);color:var(--seti-fg,#d7dce5);font-size:13px;min-width:2.6rem;min-height:2.2rem;font-weight:600;border:0;border-radius:8px;cursor:pointer;transition:transform .06s,background .15s,opacity .15s}
.seti-chat__navkeys-esc{font-size:11px;font-weight:700;letter-spacing:.03em}
.seti-chat__navkeys button:hover{filter:brightness(1.25)}
.seti-chat__navkeys button:active{transform:translateY(1px) scale(.98)}
.seti-chat__navkeys button:disabled{opacity:.5;cursor:not-allowed}
.seti-chat__form{display:flex;gap:.5rem;padding:.6rem;background:var(--seti-panel,#11151f);border-top:1px solid var(--seti-edge,#1e2430)}
.seti-chat__input{flex:1;min-width:0;background:var(--seti-bg,#0b0e14);border:1px solid var(--seti-edge,#1e2430);color:var(--seti-fg,#d7dce5);border-radius:10px;padding:.65rem .85rem;font-family:var(--seti-mono,ui-monospace,Menlo,monospace);font-size:16px;outline:none}
.seti-chat__input:focus{border-color:var(--seti-accent,#34d399);box-shadow:0 0 0 3px rgba(52,211,153,.15)}
.seti-chat__send{background:var(--seti-accent,#34d399);color:#07120d;border:0;border-radius:10px;padding:.65rem 1.05rem;font-weight:650;cursor:pointer;transition:transform .06s,background .15s,opacity .15s}
.seti-chat__send:hover{filter:brightness(1.08)}
.seti-chat__send:active{transform:translateY(1px) scale(.99)}
.seti-chat__send:disabled{opacity:.5;cursor:not-allowed}
.seti-chat__send.is-sending{background:var(--seti-warn,#fbbf24);color:#2a1d00}
`;

function ensureStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function SetiChat(props: SetiChatProps) {
  const client = useMemo(
    () => props.client ?? new SetiClient({ baseUrl: props.baseUrl ?? "/api/seti" }),
    [props.client, props.baseUrl],
  );
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [screenText, setScreenText] = useState("");
  const [edgeOn, setEdgeOn] = useState<boolean | null>(null);
  const [streamState, setStreamState] = useState<SetiStreamState>("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const screenRef = useRef<HTMLPreElement>(null);

  useEffect(ensureStyle, []);

  useEffect(() => {
    const acc = new FrameAccumulator();
    setScreenText("");
    setNotice(null);
    const atBottom = (): boolean => {
      const s = screenRef.current;
      return !s || s.scrollHeight - s.scrollTop - s.clientHeight < 40;
    };
    let first = true;
    const handle = client.openStream(props.edge, props.session, {
      onHello: (h) => setEdgeOn(h.edgeConnected),
      onPing: (p) => setEdgeOn(p.edgeConnected),
      onStateChange: setStreamState,
      onFrame: (content) => {
        // First frame lands you at the LATEST line (cc's now), not the top of a
        // tall scrollback — then the existing stick-to-bottom takes over.
        const stick = first || atBottom();
        first = false;
        acc.feed(content);
        setScreenText(acc.text);
        if (stick) {
          requestAnimationFrame(() => {
            const s = screenRef.current;
            if (s) s.scrollTop = s.scrollHeight;
          });
        }
      },
    });
    return () => handle.close();
  }, [client, props.edge, props.session]);

  const meta =
    streamState === "open"
      ? edgeOn === false
        ? `${props.edge} · edge offline`
        : `${props.edge} · ${props.session}`
      : streamState === "closed"
        ? "lukket"
        : "forbinder…";
  const dotClass =
    "seti-chat__dot" + (streamState === "open" && edgeOn ? " is-on" : edgeOn === false ? " is-bad" : "");

  const submit = async (ev: Event) => {
    ev.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setNotice(null);
    const res = await client.sendText(props.edge, props.session, text);
    if (res.ok) {
      setText(""); // only clear when actually delivered — text survives failures
    } else {
      setNotice("Ikke leveret — din tekst er bevaret");
    }
    setSending(false);
  };

  const pressKey = async (key: SetiKey) => {
    await client.sendKey(props.edge, props.session, key);
  };

  return (
    <div class={"seti-chat" + (props.class ? ` ${props.class}` : "")} data-testid="seti-chat-root">
      <div class="seti-chat__header" data-testid="seti-chat-header">
        <span class={dotClass} data-testid="seti-chat-status-dot" />
        <span class="seti-chat__meta" data-testid="seti-chat-meta">
          {notice ?? meta}
        </span>
      </div>
      <pre
        ref={screenRef}
        class={"seti-chat__screen" + (screenText ? "" : " is-empty")}
        data-testid="seti-chat-screen"
      >
        {screenText || "Venter på den første frame fra edgen…"}
      </pre>
      <div class="seti-chat__navkeys" data-testid="seti-chat-navkeys">
        {NAV_KEYS.map((k) => (
          <button
            key={k.key}
            type="button"
            title={k.title}
            data-testid={`seti-chat-key-${k.key.toLowerCase()}`}
            onClick={() => void pressKey(k.key)}
          >
            <NavGlyph k={k.key} />
          </button>
        ))}
      </div>
      {!props.hideInput && (
      <form class="seti-chat__form" data-testid="seti-chat-form" onSubmit={submit}>
        <textarea
          class="seti-chat__input"
          data-testid="seti-chat-input"
          rows={2}
          value={text}
          placeholder={props.placeholder ?? "Skriv til sessionen…"}
          // NB: never autocomplete="off" — on iOS Safari it degrades the whole
          // keyboard (kills autocorrect/auto-capitalize/dictation + shows the
          // AutoFill strip). Keep password managers out with these instead.
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter inserts a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(e);
            }
          }}
        />
        <button
          type="submit"
          class={"seti-chat__send" + (sending ? " is-sending" : "")}
          data-testid="seti-chat-send"
          disabled={sending}
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
      )}
    </div>
  );
}

export { SetiClient } from "./client";
export type { SetiKey } from "./types";
