// @broberg/lens-engine — request boundary (Zod). The JSON-serialisable inputs
// for capture()/runFlow() + the frozen /flow step grammar + the self-healing
// LocateSpec. Consumers reuse these schemas to validate at their own HTTP
// boundary; the engine functions themselves take TS options (which widen
// `storageState` to also allow an async resolver — see capture.ts/flow.ts).
//
// AUTH-AGNOSTIC: the engine never fetches a mint endpoint. It applies a
// `storageState` the CONSUMER supplies (resolved object, or a resolver it
// injects). `mintAuthSchema` + `fetchStorageState` (mint.ts) ship as an OPTIONAL
// consumer helper so a hosted service can build that resolver without re-rolling
// the mint POST — but the engine core does not call it.

import { z } from 'zod';

export const captureModeSchema = z.enum(['viewport', 'fullPage', 'element']);
export type CaptureMode = z.infer<typeof captureModeSchema>;

/** Mint-endpoint auth for capturing behind a target's login — the input to the
 *  OPTIONAL `fetchStorageState` helper (mint.ts). A consumer POSTs `url` with
 *  `Authorization: Bearer <secret>` (+ optional `body`) → receives a Playwright
 *  storageState → passes it to capture()/runFlow() as `storageState`. The engine
 *  itself never sees `secret`. */
export const mintAuthSchema = z.object({
  adapter: z.literal('mintEndpoint'),
  url: z.string().url(),
  /** The narrow "mint a lens session" bearer secret. Sent as Authorization:
   *  Bearer to the target only; never logged, never persisted. */
  secret: z.string().min(1).optional(),
  /** Optional non-secret JSON body forwarded to the mint endpoint (e.g.
   *  { org, site } or { mode:'write', writes:true }). Validated by the target. */
  body: z.record(z.unknown()).optional(),
  /** Optional extra non-secret headers for the mint request. */
  headers: z.record(z.string()).optional(),
});
export type MintAuth = z.infer<typeof mintAuthSchema>;

export const viewportSchema = z.object({
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
});

/** The Playwright storageState shape a mint endpoint returns (cookies +
 *  per-origin localStorage). Applied to a fresh context before navigation. */
export const storageStateSchema = z.object({
  cookies: z.array(z.record(z.unknown())).optional(),
  origins: z
    .array(
      z.object({
        origin: z.string(),
        localStorage: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
      }),
    )
    .optional(),
});
export type StorageState = z.infer<typeof storageStateSchema>;

export const captureBodySchema = z.object({
  url: z.string().url(),
  mode: captureModeSchema.optional(),
  /** Required for `element` mode. A CSS selector, or a bare data-testid VALUE
   *  which resolveSelector wraps as [data-testid="…"]. */
  selector: z.string().min(1).optional(),
  viewport: viewportSchema.optional(),
  /** Named device preset (a small built-in map, e.g. "iphone-14"). */
  device: z.string().min(1).optional(),
  /** Wait gate after navigation: a CSS selector (string) or ms (number). */
  waitFor: z.union([z.number().int().min(0).max(60_000), z.string().min(1)]).optional(),
  /** Pre-resolved storageState to capture behind a login (object form). The
   *  engine's capture() also accepts an async resolver here — not expressible in
   *  JSON, so a hosted consumer validates the object form and passes a resolver
   *  programmatically. */
  storageState: storageStateSchema.optional(),
});
export type CaptureBody = z.infer<typeof captureBodySchema>;

// ── /flow — multi-step E2E manuscript ────────────────────────────────────────
// The frozen step grammar, plus an `upload` step for setInputFiles (the
// storeform use case: drive Google Play / App Store Connect consoles for the
// uploads + config their official APIs can't do). A `target` is a CSS selector
// OR a bare data-testid VALUE (resolveSelector wraps it) OR a self-healing
// LocateSpec.

/** One file for an `upload` step. Provide EXACTLY one source: a `url` the engine
 *  fetches, or inline `content_base64` (small assets like icons/screenshots).
 *  Large store binaries (.aab/.ipa) should use `url` — base64 in JSON is heavy. */
export const uploadFileSchema = z
  .object({
    name: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    url: z.string().url().optional(),
    content_base64: z.string().min(1).optional(),
  })
  .refine((f) => Boolean(f.url) !== Boolean(f.content_base64), {
    message: 'provide exactly one of url | content_base64',
  });
export type UploadFile = z.infer<typeof uploadFileSchema>;

// Self-healing layered locator. A step's `target` is EITHER a plain string (CSS
// selector or bare data-testid — unchanged) OR a LocateSpec with several hints
// the resolver tries in priority order (testid → css → role → label →
// placeholder → text), first unique visible match wins. `vision` is the Set-of-
// Marks fallback (vision.ts) — a vision-only DOM-miss fails cleanly, never guesses.
export const locateSpecSchema = z
  .object({
    testid: z.string().min(1).optional(),
    css: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    /** Accessible name for `role` (getByRole(role, {name})). */
    name: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    placeholder: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    /** Exact match for name/label/placeholder/text (default false = substring/fuzzy). */
    exact: z.boolean().optional(),
    /** Pick the nth match when a layer is ambiguous (default 0 = first). */
    nth: z.number().int().min(0).optional(),
    /** Natural-language description for the vision (Set-of-Marks) fallback. */
    vision: z.string().min(1).optional(),
  })
  .refine(
    (s) => Boolean(s.testid || s.css || s.role || s.label || s.placeholder || s.text || s.vision),
    { message: 'locate needs at least one of testid/css/role/label/placeholder/text/vision' },
  );
export type LocateSpec = z.infer<typeof locateSpecSchema>;

/** A step target: a string (CSS/testid) or a self-healing LocateSpec. */
export const targetSchema = z.union([z.string().min(1), locateSpecSchema]);
export type Target = z.infer<typeof targetSchema>;

/** Wait gate for a `goto` step: a CSS selector/testid (string) or ms (number). */
const gotoWaitSchema = z.union([z.number().int().min(0).max(60_000), z.string().min(1)]);

export const flowStepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goto'), url: z.string().min(1), waitFor: gotoWaitSchema.optional() }),
  z.object({ action: z.literal('click'), target: targetSchema }),
  z.object({ action: z.literal('fill'), target: targetSchema, value: z.string() }),
  // `type` presses keys sequentially (real keydown/input) — robust for controlled
  // inputs where a direct value-set (`fill`) doesn't register a framework onInput.
  z.object({ action: z.literal('type'), target: targetSchema, text: z.string() }),
  z.object({ action: z.literal('press'), key: z.string().min(1), target: targetSchema.optional() }),
  z.object({ action: z.literal('select'), target: targetSchema, value: z.string() }),
  z.object({ action: z.literal('upload'), target: targetSchema, files: z.array(uploadFileSchema).min(1) }),
  z.object({
    action: z.literal('waitFor'),
    target: targetSchema.optional(),
    ms: z.number().int().min(0).max(60_000).optional(),
  }),
  z.object({ action: z.literal('assert'), js: z.string().min(1) }),
  z.object({ action: z.literal('expectText'), target: targetSchema, text: z.string().min(1) }),
  z.object({ action: z.literal('expectVisible'), target: targetSchema }),
  z.object({ action: z.literal('expectEditable'), target: targetSchema }),
  z.object({
    action: z.literal('screenshot'),
    name: z.string().min(1).optional(),
    mode: captureModeSchema.optional(),
    target: targetSchema.optional(),
  }),
]);
export type FlowStep = z.infer<typeof flowStepSchema>;

export const flowBodySchema = z.object({
  /** Optional run label (echoed back for the caller's logs). */
  name: z.string().min(1).optional(),
  /** Absolute base; a step's relative `url` resolves against this. */
  base_url: z.string().url(),
  viewport: viewportSchema.optional(),
  device: z.string().min(1).optional(),
  /** Pre-resolved storageState (object form); the engine's runFlow() also accepts
   *  an async resolver here. */
  storageState: storageStateSchema.optional(),
  /** Hint that this flow mutates real target state (e.g. a store submission) —
   *  echoed back; the engine does not gate on it (the caller owns that policy). */
  mutates: z.boolean().optional(),
  steps: z.array(flowStepSchema).min(1).max(100),
});
export type FlowBody = z.infer<typeof flowBodySchema>;
