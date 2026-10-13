// @broberg/editor — F101.3. ONE implementation of the hooks and the reference UI, built for React and
// for Preact from their own createElement + hooks (react.ts / preact.ts), so the two adapters cannot
// drift apart. No JSX: plain createElement calls work in both.
//
// cms' traps (#3230) that live here:
//  1. SSR: the editor is created in an EFFECT — never during render — so Next.js renders nothing
//     editor-shaped on the server and hydrates cleanly (TipTap's immediatelyRender:false, by design).
//  2. Toolbar state is read on transactions and only re-renders when it CHANGED, not per keystroke.
//  4. A new `docKey` destroys the editor and builds a fresh one — the previous document never leaks in.
import { Editor } from "@tiptap/core";
import { editorOptions, insertImage, markLoaded, run, setLink, toolbarState, type EditorConfig, type ToolbarAction, type ToolbarState } from "./index";
import { insertBlock, type Block } from "./blocks";

/* eslint-disable @typescript-eslint/no-explicit-any */
type H = (type: any, props?: any, ...children: any[]) => any;
export interface Runtime {
  h: H;
  useState: <T>(init: T | (() => T)) => [T, (v: T | ((p: T) => T)) => void];
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => void;
  useRef: <T>(init: T) => { current: T };
}

export interface EditorHookConfig extends EditorConfig {
  /** Change it to load ANOTHER document: the editor is rebuilt (cms trap 4). `content` is read at (re)build only. */
  docKey?: string | number;
}

export interface ToolbarLabels {
  bold: string; italic: string; strike: string; h1: string; h2: string; h3: string; bulletList: string; orderedList: string;
  blockquote: string; link: string; image: string; undo: string; redo: string;
  linkPlaceholder: string; linkApply: string; linkRemove: string; linkCancel: string; linkInvalid: string; uploading: string;
}

export const DEFAULT_LABELS: ToolbarLabels = {
  bold: "Fed", italic: "Kursiv", strike: "Gennemstreget", h1: "Overskrift 1", h2: "Overskrift 2", h3: "Overskrift 3",
  bulletList: "Punktliste", orderedList: "Nummereret liste", blockquote: "Citat", link: "Link", image: "Billede",
  undo: "Fortryd", redo: "Gentag", linkPlaceholder: "https://…", linkApply: "Gem link", linkRemove: "Fjern link",
  linkCancel: "Annullér", linkInvalid: "Det er ikke et gyldigt link", uploading: "Uploader billede…",
};

export interface ToolbarProps {
  editor: Editor | null;
  labels?: Partial<ToolbarLabels>;
  uploadImage?: EditorConfig["uploadImage"];
  onError?: EditorConfig["onError"];
  blocks?: Block[];
  /** Per block name: open YOUR picker (a product search …) and resolve its attributes, or null to cancel. */
  blockPickers?: Record<string, () => Promise<Record<string, string> | null>>;
}

export interface RichTextEditorProps extends EditorHookConfig, Omit<ToolbarProps, "editor"> {
  /** false hides the reference toolbar (draw your own with useToolbarState). */
  toolbar?: boolean;
  className?: string;
  testid?: string;
}

const BUTTONS: { action: ToolbarAction | "link" | "image"; text: string }[] = [
  { action: "bold", text: "B" }, { action: "italic", text: "I" }, { action: "strike", text: "S" },
  { action: "h1", text: "H1" }, { action: "h2", text: "H2" }, { action: "h3", text: "H3" },
  { action: "bulletList", text: "•" }, { action: "orderedList", text: "1." }, { action: "blockquote", text: "❝" },
  { action: "link", text: "Link" }, { action: "image", text: "Billede" },
  { action: "undo", text: "↶" }, { action: "redo", text: "↷" },
];

export function makeAdapter(R: Runtime) {
  const { h, useState, useEffect, useRef } = R;

  /** The editor for a container you render: `<div ref={ref} />`. `editor` is null until mounted (and on the server). */
  function useEditor(config: EditorHookConfig): { editor: Editor | null; ref: { current: HTMLDivElement | null } } {
    const ref = useRef<HTMLDivElement | null>(null);
    const [editor, setEditor] = useState<Editor | null>(null);
    const latest = useRef(config);
    latest.current = config; // callbacks always reach the newest props without rebuilding the editor
    useEffect(() => {
      const element = ref.current;
      if (!element) return;
      let ed: Editor | null = null;
      const live: EditorConfig = {
        ...latest.current,
        onChange: (md) => latest.current.onChange?.(md),
        onError: (e) => latest.current.onError?.(e),
        ...(latest.current.uploadImage ? { uploadImage: (f: File) => latest.current.uploadImage!(f) } : {}),
      };
      ed = new Editor({ element, ...editorOptions(live, () => ed) });
      markLoaded(ed);
      setEditor(ed);
      return () => {
        ed?.destroy();
        setEditor(null);
      };
    }, [config.docKey]);
    return { editor, ref };
  }

  /** What a toolbar shows; re-renders only when it changes (cms trap 2). */
  function useToolbarState(editor: Editor | null): ToolbarState | null {
    const [state, setState] = useState<ToolbarState | null>(() => (editor ? toolbarState(editor) : null));
    useEffect(() => {
      if (!editor) {
        setState(null);
        return;
      }
      let last = "";
      const update = () => {
        const next = toolbarState(editor);
        const key = JSON.stringify(next);
        if (key !== last) {
          last = key;
          setState(next);
        }
      };
      update();
      editor.on("transaction", update);
      editor.on("selectionUpdate", update);
      return () => {
        editor.off("transaction", update);
        editor.off("selectionUpdate", update);
      };
    }, [editor]);
    return state;
  }

  function Toolbar(p: ToolbarProps) {
    const L = { ...DEFAULT_LABELS, ...p.labels };
    const st = useToolbarState(p.editor);
    const [linkOpen, setLinkOpen] = useState(false);
    const [linkValue, setLinkValue] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const ed = p.editor;
    const keep = (e: Event) => e.preventDefault(); // a toolbar click must not steal the editor's selection

    const fail = (e: Error) => {
      setError(e.message);
      p.onError?.(e);
    };
    const click = (action: (typeof BUTTONS)[number]["action"]) => {
      if (!ed) return;
      setError(null);
      if (action === "link") {
        setLinkValue(st?.link ?? "");
        setLinkOpen(true);
      } else if (action === "image") fileRef.current?.click();
      else run(ed, action);
    };
    const applyLink = () => {
      if (!ed) return;
      if (!linkValue.trim()) {
        setLink(ed, null);
        setLinkOpen(false);
      } else if (setLink(ed, linkValue.trim())) setLinkOpen(false);
      else setError(L.linkInvalid);
    };
    const pickFile = async (e: Event) => {
      const input = e.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (!file || !ed || !p.uploadImage) return;
      setBusy(true);
      setError(null);
      await insertImage(ed, { uploadImage: p.uploadImage, onError: fail }, file);
      setBusy(false);
    };
    const pickBlock = async (block: Block) => {
      const picker = p.blockPickers?.[block.name];
      if (!ed || !picker) return;
      const attrs = await picker();
      if (attrs) insertBlock(ed, block, attrs);
    };

    const isOn = (a: string) => (st?.active as Record<string, boolean> | undefined)?.[a] ?? (a === "link" ? !!st?.link : false);
    const disabled = (a: string) => !ed || (a === "undo" && !st?.can.undo) || (a === "redo" && !st?.can.redo) || (a === "image" && (!p.uploadImage || busy));

    return h(
      "div",
      { className: "bre-toolbar", role: "toolbar", "data-testid": "editor-toolbar" },
      ...BUTTONS.filter((b) => b.action !== "image" || p.uploadImage).map((b) =>
        h(
          "button",
          {
            type: "button",
            key: b.action,
            className: "bre-btn",
            "data-testid": `editor-toolbar-${b.action}`,
            "aria-label": L[b.action as keyof ToolbarLabels],
            title: L[b.action as keyof ToolbarLabels],
            "aria-pressed": b.action === "undo" || b.action === "redo" || b.action === "image" ? undefined : isOn(b.action),
            "aria-busy": b.action === "image" && busy ? true : undefined,
            disabled: disabled(b.action),
            onMouseDown: keep,
            onClick: () => click(b.action),
          },
          b.action === "image" && busy ? "…" : b.text,
        ),
      ),
      ...(p.blocks ?? [])
        .filter((b) => p.blockPickers?.[b.name])
        .map((b) =>
          h("button", { type: "button", key: `block-${b.name}`, className: "bre-btn", "data-testid": `editor-toolbar-block-${b.name}`, title: b.label, disabled: !ed, onMouseDown: keep, onClick: () => void pickBlock(b) }, b.label),
        ),
      p.uploadImage
        ? h("input", { ref: fileRef, type: "file", accept: "image/*", hidden: true, "data-testid": "editor-image-input", onChange: pickFile })
        : null,
      busy ? h("span", { className: "bre-status", role: "status", "data-testid": "editor-uploading" }, L.uploading) : null,
      error ? h("span", { className: "bre-error", role: "alert", "data-testid": "editor-toolbar-error" }, error) : null,
      linkOpen
        ? h(
            "div",
            { className: "bre-popover", role: "dialog", "aria-label": L.link, "data-testid": "editor-link-popover" },
            h("input", {
              className: "bre-input",
              type: "url",
              value: linkValue,
              placeholder: L.linkPlaceholder,
              "aria-label": L.link,
              "data-testid": "editor-link-input",
              autoFocus: true,
              onInput: (e: Event) => setLinkValue((e.currentTarget as HTMLInputElement).value),
              onChange: (e: Event) => setLinkValue((e.currentTarget as HTMLInputElement).value),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                } else if (e.key === "Escape") setLinkOpen(false);
              },
            }),
            h("button", { type: "button", className: "bre-btn is-primary", "data-testid": "editor-link-apply", onClick: applyLink }, L.linkApply),
            st?.link ? h("button", { type: "button", className: "bre-btn", "data-testid": "editor-link-remove", onClick: () => { if (ed) setLink(ed, null); setLinkOpen(false); } }, L.linkRemove) : null,
            h("button", { type: "button", className: "bre-btn", "data-testid": "editor-link-cancel", onClick: () => setLinkOpen(false) }, L.linkCancel),
          )
        : null,
    );
  }

  /** The whole thing: reference toolbar + editor. Design it with css/editor.css or your own CSS. */
  function RichTextEditor(p: RichTextEditorProps) {
    const { editor, ref } = useEditor(p);
    return h(
      "div",
      { className: ["bre", p.className].filter(Boolean).join(" "), "data-testid": p.testid ?? "editor-root" },
      p.toolbar === false ? null : h(Toolbar, { editor, labels: p.labels, uploadImage: p.uploadImage, onError: p.onError, blocks: p.blocks, blockPickers: p.blockPickers }),
      h("div", { ref, className: "bre-content", "data-testid": "editor-content" }),
    );
  }

  return { useEditor, useToolbarState, Toolbar, RichTextEditor };
}
