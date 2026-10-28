// @broberg/notifications/preact — F074.4.
//
// NOT a second implementation. This entry re-exports the React wrapper, and the
// build compiles it with every `react` import resolved to `preact/compat`
// (tsup.config.ts). One source, so the two cannot drift — and the SAME
// behaviour suite runs against both (vitest.workspace.ts, AC#12).
export * from "./react.js";
