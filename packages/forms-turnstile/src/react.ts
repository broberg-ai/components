/**
 * React adapter (Stack A — Next.js / React 19) — the widget hook, bound to
 * React's hooks.
 *
 * Requested by fd-sundhed (#20104), who need it on a Next.js contact form and a
 * landing-page "ask a question" form and correctly refused to hand-copy the
 * Preact version into their own repo. The implementation lives in
 * ./use-turnstile-core, so this file is the import line and nothing else — which
 * is exactly what their reading of the published tarball predicted.
 *
 * `"use client"` is deliberate: the hook touches `document` and `window`, so it
 * can only run in a browser. Without it a Next.js app importing this from a
 * server component fails at build time with an error that points at React
 * internals rather than at this package.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { createUseTurnstile } from "./use-turnstile-core";

export type { TurnstileStatus, UseTurnstileResult } from "./use-turnstile-core";

export const useTurnstile = createUseTurnstile({ useRef, useState, useEffect });
