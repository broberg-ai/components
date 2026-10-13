// @broberg/editor/react — F101.3. Next.js-safe: the editor is created in an effect, never on the server.
import { createElement, useEffect, useRef, useState } from "react";
import { makeAdapter, type Runtime } from "./adapter";

const a = makeAdapter({ h: createElement as never, useState: useState as Runtime["useState"], useEffect, useRef: useRef as Runtime["useRef"] });
export const useEditor = a.useEditor;
export const useToolbarState = a.useToolbarState;
export const Toolbar = a.Toolbar;
export const RichTextEditor = a.RichTextEditor;
export { DEFAULT_LABELS, type EditorHookConfig, type RichTextEditorProps, type ToolbarLabels, type ToolbarProps } from "./adapter";
export * from "./index";
