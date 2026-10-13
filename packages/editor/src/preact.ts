// @broberg/editor/preact — F101.3. The same hooks and UI as /react, on Preact (cardmem).
import { h as createElement } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { makeAdapter, type Runtime } from "./adapter";

const a = makeAdapter({ h: createElement as never, useState: useState as Runtime["useState"], useEffect, useRef: useRef as Runtime["useRef"] });
export const useEditor = a.useEditor;
export const useToolbarState = a.useToolbarState;
export const Toolbar = a.Toolbar;
export const RichTextEditor = a.RichTextEditor;
export { DEFAULT_LABELS, type EditorHookConfig, type RichTextEditorProps, type ToolbarLabels, type ToolbarProps } from "./adapter";
export * from "./index";
