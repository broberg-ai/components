/**
 * Preact adapter (Stack B) — the widget hook, bound to preact/hooks.
 *
 * The implementation lives in ./use-turnstile-core so React and Preact cannot
 * drift apart. Ports the loadTurnstile/render pattern proven in xrt81's
 * KomIGang.tsx lead form.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { createUseTurnstile } from "./use-turnstile-core";

export type { TurnstileStatus, UseTurnstileResult } from "./use-turnstile-core";

export const useTurnstile = createUseTurnstile({ useRef, useState, useEffect });
