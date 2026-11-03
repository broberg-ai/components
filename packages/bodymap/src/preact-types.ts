// @broberg/bodymap/preact — TYPES for the Preact build (F052.4).
//
// The JavaScript of ./preact is the SAME source as ./react (src/react.tsx), compiled with
// react → preact/hooks and the Preact JSX runtime (see tsup.config.ts). One renderer, two
// frameworks — so the two can never drift. This file only gives Preact apps types that do
// not mention React.
import type { VNode } from "preact";
import type { BodyMapProps, BodyMapCompareProps, BodyMapLabels } from "./react.js";

export type { BodyMapProps, BodyMapCompareProps, BodyMapLabels, BodyMapLocale, BodyView2D } from "./react.js";

/** 2D SVG body pain-map. Click/tap a region → set intensity + quality → PainReport. */
export declare function BodyMap(props: BodyMapProps): VNode;
/** Read-only before/after view: two bodies side by side + a per-region change list. */
export declare function BodyMapCompare(props: BodyMapCompareProps): VNode;
export declare const LABELS_DA: BodyMapLabels;
export declare const LABELS_EN: BodyMapLabels;
