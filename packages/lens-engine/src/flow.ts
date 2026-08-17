// @broberg/lens-engine — runFlow: a multi-step E2E manuscript.
//
// Reuses the SAME warm-browser + settle + screenshot helpers as capture() (no
// second engine). The step grammar (goto/click/fill/type/press/select/waitFor/
// assert/expectText/expectVisible/expectEditable/screenshot) plus `upload` (setInputFiles) for
// the store-console use case. Self-healing locators: a step target is a CSS/
// testid string OR a LocateSpec whose DOM layers (testid→css→role→label→
// placeholder→text) are tried in order, with a Set-of-Marks vision fallback.
//
// A failing step STOPS the flow and pins a failure screenshot to that step, so
// the caller sees exactly where + in what state it broke. AUTH-AGNOSTIC: runFlow
// takes a `storageState` (object OR async resolver) — never fetches a mint
// endpoint itself. Storage of the per-step PNGs is the caller's job.

import { type BrowserContext, type Locator, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import {
  armIdleTimer,
  getBrowser,
  resolveSelector,
  resolveStorageState,
  resolveViewport,
  settle,
  takeShot,
  type StorageStateInput,
} from './capture';
import { applyStorageState } from './mint';
import { resolveVisionElement, visionEnabled } from './vision';
import type { CaptureMode, FlowBody, FlowStep, LocateSpec, Target, UploadFile } from './schema';

const DEFAULT_TIMEOUT_MS = 30_000;
/** Per-file upload ceiling. A file is fully buffered in memory before
 *  setInputFiles, so cap it to stay safe on a modest host. Bigger store binaries
 *  should be chunked by the caller or the machine sized up. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_FETCH_TIMEOUT_MS = 60_000;

export interface FlowOptions extends Omit<FlowBody, 'storageState'> {
  /** Pre-resolved storageState OR an async resolver (auth-agnostic). */
  storageState?: StorageStateInput;
}

export interface FlowStepReport {
  index: number;
  action: FlowStep['action'];
  status: 'ok' | 'failed';
  ms: number;
  /** Short human detail (target, url, assert result) for the caller's log. */
  detail?: string;
  /** Which locator layer resolved the target (selector|testid|css|role|label|
   *  placeholder|text|vision). The audit trail for a self-healed field. */
  resolved_via?: string;
  error?: string;
  /** Present for `screenshot` steps + the auto failure-shot; the caller turns the
   *  PNG into a stored URL and strips the bytes from the response. */
  png?: Buffer;
  screenshot_run_id?: string;
  screenshot_url?: string | null;
}

/**
 * Is this element editable RIGHT NOW? Editable =
 *  - contenteditable: the NEAREST ancestor carrying the attribute wins
 *    ("" / "true" / "plaintext-only" ⇒ editable; "false" ⇒ not; inherited counts;
 *    "inherit"/absent keeps walking up), OR
 *  - an enabled, writable native form control: an <input>/<textarea> that is not
 *    `disabled` and not `readOnly`, or a <select> that is not `disabled`.
 *
 * Pure + self-contained (no closures, only its arg + DOM globals) so it BOTH
 * unit-tests over jsdom AND serializes into the page via `locator.evaluate` — one
 * definition of "editable", identical on both sides. Powers the `expectEditable`
 * flow step (prove @broberg/cms-inline-edit click-to-edit turned a field editable).
 */
export function isEditableElement(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const f = el as HTMLInputElement | HTMLTextAreaElement;
    return !f.disabled && !f.readOnly;
  }
  if (tag === 'SELECT') return !(el as HTMLSelectElement).disabled;
  let node: Element | null = el;
  while (node) {
    const v = node.getAttribute('contenteditable');
    if (v === 'false') return false;
    if (v === '' || v === 'true' || v === 'plaintext-only') return true;
    node = node.parentElement;
  }
  return false;
}

export interface FlowResult {
  run_id: string;
  name?: string;
  status: 'passed' | 'failed';
  steps: FlowStepReport[];
  final_url?: string;
}

/** The ordered locator layers a LocateSpec WOULD try (pure; sealed by a unit test
 *  so the self-healing priority contract can't silently drift). */
export function plannedLayers(spec: LocateSpec): string[] {
  const layers: string[] = [];
  if (spec.testid) layers.push('testid');
  if (spec.css) layers.push('css');
  if (spec.role) layers.push('role');
  if (spec.label) layers.push('label');
  if (spec.placeholder) layers.push('placeholder');
  if (spec.text) layers.push('text');
  if (spec.vision) layers.push('vision'); // fallback layer — Set-of-Marks
  return layers;
}

/** The implicit setup navigation before step 0. The daemon flow-runner opens
 *  `base_url` first, so a flow that doesn't start with its own `goto` runs step 0
 *  on the page, not about:blank. Returns the base_url to pre-navigate to, or null
 *  when a leading `goto` already handles it (idempotent) or there is no base_url.
 *  Pure + exported so the parity contract is sealed by a unit test (like
 *  plannedLayers) and can't silently drift from the daemon. */
export function leadingNavigation(body: Pick<FlowBody, 'base_url' | 'steps'>): string | null {
  if (!body.base_url) return null;
  if (body.steps[0]?.action === 'goto') return null;
  return body.base_url;
}

/** A compact label for a target (the primary hint), for the step report's detail. */
function describeTarget(t: Target): string {
  if (typeof t === 'string') return t;
  return t.testid ?? t.css ?? t.role ?? t.label ?? t.placeholder ?? t.text ?? t.vision ?? 'locate';
}

/** Try the LocateSpec's DOM layers in fixed order (testid→css→role→label→
 *  placeholder→text). Returns the first match + its layer, or null if all miss.
 *  Never throws for a missing element — a miss is a null, not an error. */
async function tryDomLayers(page: Page, spec: LocateSpec): Promise<{ locator: Locator; layer: string } | null> {
  const nth = spec.nth ?? 0;
  const exact = spec.exact ?? false;
  const attempts: Array<{ layer: string; make: () => Locator }> = [];
  if (spec.testid) attempts.push({ layer: 'testid', make: () => page.getByTestId(spec.testid!) });
  if (spec.css) attempts.push({ layer: 'css', make: () => page.locator(spec.css!) });
  if (spec.role)
    attempts.push({
      layer: 'role',
      make: () =>
        page.getByRole(spec.role as Parameters<Page['getByRole']>[0], spec.name ? { name: spec.name, exact } : {}),
    });
  if (spec.label) attempts.push({ layer: 'label', make: () => page.getByLabel(spec.label!, { exact }) });
  if (spec.placeholder)
    attempts.push({ layer: 'placeholder', make: () => page.getByPlaceholder(spec.placeholder!, { exact }) });
  if (spec.text) attempts.push({ layer: 'text', make: () => page.getByText(spec.text!, { exact }) });

  for (const a of attempts) {
    try {
      const loc = a.make();
      if ((await loc.count()) > nth) return { locator: loc.nth(nth), layer: a.layer };
    } catch {
      /* an invalid selector for this layer — try the next */
    }
  }
  return null;
}

export interface ResolveTargetResult {
  locator: Locator;
  /** Which layer matched: selector|testid|css|role|label|placeholder|text|vision. */
  resolved_via: string;
}

/** Self-healing resolve — the ONE resolver the cloud runFlow AND the local daemon
 *  call, so their self-heal layer can't drift (F050). A string target is the
 *  selector layer (CSS/testid). A LocateSpec tries its DOM layers in fixed order
 *  (testid→css→role→label→placeholder→text); if they all miss AND `vision` is set,
 *  it falls back to the Set-of-Marks vision layer (→ a REAL element, so every
 *  action uses it uniformly). Throws (clean, never a guess) when nothing matches.
 *  RECEIVES `page` (never constructs one) → runtime-safe across Playwright minor
 *  versions. `opts.action` only labels the missing-target error. */
export async function resolveTarget(
  page: Page,
  target: Target,
  opts?: { action?: string },
): Promise<ResolveTargetResult> {
  if (target == null) {
    throw new Error(`${opts?.action ?? 'locate'} step requires a target (a selector, data-testid, or locate spec)`);
  }
  if (typeof target === 'string') {
    return { locator: page.locator(resolveSelector(target)).first(), resolved_via: 'selector' };
  }
  const dom = await tryDomLayers(page, target);
  if (dom) return { locator: dom.locator, resolved_via: dom.layer };
  if (target.vision) {
    if (!visionEnabled()) {
      throw new Error(
        `locate: DOM layers missed; vision fallback is dark (set LENS_VISION_ENABLED=1 + a provider key) for "${target.vision}"`,
      );
    }
    return { locator: await resolveVisionElement(page, target.vision), resolved_via: 'vision' };
  }
  throw new Error(`locate: no layer matched ${JSON.stringify(target)}`);
}

/** Turn an UploadFile into Playwright's { name, mimeType, buffer } input. */
async function resolveUploadFile(f: UploadFile): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  let buffer: Buffer;
  if (f.content_base64) {
    buffer = Buffer.from(f.content_base64, 'base64');
  } else {
    // url (validated present by the schema's exactly-one-of refine).
    const res = await fetch(f.url!, { signal: AbortSignal.timeout(UPLOAD_FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`upload fetch ${f.url} → HTTP ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`upload file "${f.name}" is ${buffer.byteLength} bytes (> ${MAX_UPLOAD_BYTES} cap)`);
  }
  return { name: f.name, mimeType: f.mimeType ?? 'application/octet-stream', buffer };
}

/** How long ONE step may take: its own `timeout_ms` wins, then the flow's, then
 *  the built-in 30s.
 *
 *  Exported because this precedence is the contract, and because the way it
 *  breaks is silent — F074.51's consumer asked for 1000ms, got "Timeout 15000ms
 *  exceeded", and storeform spent two days believing Google Play Console was
 *  slow. A test that only checks "we passed the argument somewhere" would have
 *  been green throughout that. */
export function resolveStepTimeout(
  step: { timeout_ms?: number },
  flow: { timeout_ms?: number },
): number {
  return step.timeout_ms ?? flow.timeout_ms ?? DEFAULT_TIMEOUT_MS;
}

/** Execute one step. Returns detail + optional PNG (screenshot steps) + the
 *  locator layer that resolved the target. Throws on failure — the caller records
 *  it + stops the flow.
 *
 *  Exported (F071.1) so the timeout can be proven to REACH Playwright without a
 *  browser: a test drives it with a fake Page and reads the options each locator
 *  call actually received. That is the boundary where F074.51 lost the value, so
 *  it is the boundary worth asserting on. */
export async function execStep(
  page: Page,
  step: FlowStep,
  baseUrl: string,
  timeoutMs: number,
): Promise<{ detail?: string; png?: Buffer; resolved_via?: string }> {
  switch (step.action) {
    case 'goto': {
      const url = new URL(step.url, baseUrl).toString();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await settle(page, step.waitFor, timeoutMs);
      return { detail: url };
    }
    case 'click': {
      const { locator, resolved_via: layer } = await resolveTarget(page, step.target, { action: 'click' });
      await locator.click({ timeout: timeoutMs });
      return { detail: describeTarget(step.target), resolved_via: layer };
    }
    case 'fill': {
      const { locator, resolved_via: layer } = await resolveTarget(page, step.target, { action: 'fill' });
      await locator.fill(step.value, { timeout: timeoutMs });
      return { detail: describeTarget(step.target), resolved_via: layer };
    }
    case 'type': {
      const { locator, resolved_via: layer } = await resolveTarget(page, step.target, { action: 'type' });
      await locator.pressSequentially(step.text, { timeout: timeoutMs });
      return { detail: describeTarget(step.target), resolved_via: layer };
    }
    case 'press': {
      if (step.target != null) {
        const { locator, resolved_via: layer } = await resolveTarget(page, step.target, { action: 'press' });
        await locator.press(step.key, { timeout: timeoutMs });
        return { detail: step.key, resolved_via: layer };
      }
      await page.keyboard.press(step.key);
      return { detail: step.key };
    }
    case 'select': {
      const { locator, resolved_via: layer } = await resolveTarget(page, step.target, { action: 'select' });
      await locator.selectOption(step.value, { timeout: timeoutMs });
      return { detail: `${describeTarget(step.target)}=${step.value}`, resolved_via: layer };
    }
    case 'upload': {
      const files = await Promise.all(step.files.map(resolveUploadFile));
      const { locator, resolved_via: layer } = await resolveTarget(page, step.target, { action: 'upload' });
      await locator.setInputFiles(files, { timeout: timeoutMs });
      return { detail: `${describeTarget(step.target)} ← ${files.map((f) => f.name).join(', ')}`, resolved_via: layer };
    }
    case 'waitFor': {
      let layer: string | undefined;
      if (step.target != null) {
        const r = await resolveTarget(page, step.target, { action: 'waitFor' });
        await r.locator.waitFor({ state: 'visible', timeout: timeoutMs });
        layer = r.resolved_via;
      }
      if (typeof step.ms === 'number') await page.waitForTimeout(step.ms);
      if (step.target == null && typeof step.ms !== 'number') throw new Error('waitFor step needs a target or ms');
      return { detail: step.target != null ? describeTarget(step.target) : `${step.ms}ms`, resolved_via: layer };
    }
    case 'assert': {
      // F064 — `page.evaluate(string)` evaluated the body as an EXPRESSION and
      // `if (!result)` treated every object as truthy, so `{ pass:false }` — the
      // documented form — could NEVER fail, and `return …` was a SyntaxError.
      // Measured by cardmem against this engine (#19259). Now evaluated in-page
      // by evalAssertBody, which distinguishes three outcomes.
      const out = await page.evaluate(evalAssertBody, step.js);

      if (out.kind === 'syntax') {
        throw new Error(`assert body is not valid JavaScript (${out.message}): ${step.js}`);
      }
      // A throw is not a verdict — say what exploded rather than calling it false.
      if (out.kind === 'threw') {
        throw new Error(`assert threw (${out.message}): ${step.js}`);
      }
      // F066 — an object that carries no verdict. Two different mistakes, so two
      // different sentences: naming the keys turns this into a one-line fix,
      // while a generic "invalid assert" would just make people guess.
      if (out.kind === 'no-verdict') {
        throw new Error(noVerdictMessage(out.keys, step.js));
      }
      if (!out.value) {
        // The author's own words when they used { pass, detail }.
        throw new Error(
          out.detail
            ? `assert failed (${out.detail}): ${step.js}`
            : `assert failed (falsy): ${step.js}`,
        );
      }
      return { detail: out.detail ?? step.js };
    }
    case 'expectText': {
      const { locator, resolved_via: layer } = await resolveTarget(page, step.target, { action: 'expectText' });
      await locator.waitFor({ state: 'visible', timeout: timeoutMs });
      const txt = (await locator.innerText()).trim();
      if (!txt.includes(step.text)) {
        throw new Error(`expectText: "${step.text}" not in "${txt.slice(0, 160)}"`);
      }
      return { detail: `${describeTarget(step.target)} ⊇ "${step.text}"`, resolved_via: layer };
    }
    case 'expectVisible': {
      const { locator, resolved_via: layer } = await resolveTarget(page, step.target, { action: 'expectVisible' });
      await locator.waitFor({ state: 'visible', timeout: timeoutMs });
      return { detail: describeTarget(step.target), resolved_via: layer };
    }
    case 'expectEditable': {
      const { locator, resolved_via: layer } = await resolveTarget(page, step.target, { action: 'expectEditable' });
      await locator.waitFor({ state: 'visible', timeout: timeoutMs });
      const editable = await locator.evaluate(isEditableElement);
      if (!editable) {
        throw new Error(
          `expectEditable: ${describeTarget(step.target)} is present but not editable ` +
            `(no contenteditable, or a disabled/readonly form control)`,
        );
      }
      return { detail: describeTarget(step.target), resolved_via: layer };
    }
    case 'screenshot': {
      if (step.target != null) {
        // Element shot of the resolved target (supports a LocateSpec).
        const { locator, resolved_via: layer } = await resolveTarget(page, step.target, { action: 'screenshot' });
        await locator.waitFor({ state: 'visible', timeout: timeoutMs });
        await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
        const png = await locator.screenshot();
        return { detail: step.name ?? describeTarget(step.target), png, resolved_via: layer };
      }
      const mode: CaptureMode = step.mode ?? 'viewport';
      const { png } = await takeShot(page, mode, null, timeoutMs);
      return { detail: step.name ?? mode, png };
    }
  }
}

/** Run a flow: navigate + act step by step (optionally authed via a supplied
 *  storageState), stop on the first failure with a pinned screenshot. Storage is
 *  the caller's job — each report's `png` is uploaded by the consumer. */
export async function runFlow(body: FlowOptions): Promise<FlowResult> {
  // The inlet (F071.1). The timeout was already threaded end-to-end to every
  // Playwright call below; this line was a `const` and there was no way in, so
  // every step ran on 30s whatever the caller asked for.
  //
  // Resolved THROUGH resolveStepTimeout rather than by repeating `?? DEFAULT`
  // here. Writing the rule twice is how the two Lens runners drifted apart in
  // the first place, and the mutation pass proved the point: with a second copy,
  // reverting this line broke the implicit lead navigation and NOT ONE TEST
  // NOTICED. One definition, one thing to get wrong.
  const timeoutMs = resolveStepTimeout({}, body);
  const viewport = resolveViewport(body);

  // Resolve storageState BEFORE launching so a resolver failure is a clean error.
  const storageState = await resolveStorageState(body.storageState);

  armIdleTimer();
  const browser = await getBrowser();
  const runId = randomUUID();
  const steps: FlowStepReport[] = [];
  let context: BrowserContext | null = null;
  let finalUrl: string | undefined;

  try {
    context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
      reducedMotion: 'reduce',
    });
    if (storageState) await applyStorageState(context, storageState);
    const page = await context.newPage();

    // Parity with the daemon flow-runner + least surprise: if the flow doesn't
    // open with its own `goto`, navigate to base_url before step 0 so the first
    // declared step runs on the page, not about:blank (lens-gap #15924). A leading
    // `goto` makes this a no-op (idempotent). A failure here stays DATA — a failed
    // goto step, never a thrown exception (the failed-flow-as-DATA contract).
    const lead = leadingNavigation(body);
    if (lead) {
      const started = Date.now();
      try {
        await page.goto(new URL(lead).toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await settle(page, undefined, timeoutMs);
      } catch (err) {
        let png: Buffer | undefined;
        try {
          png = await page.screenshot();
        } catch {
          /* page may be gone — no shot */
        }
        steps.push({
          index: 0,
          action: 'goto',
          status: 'failed',
          ms: Date.now() - started,
          detail: lead,
          error: err instanceof Error ? err.message : String(err),
          ...(png ? { png, screenshot_run_id: randomUUID() } : {}),
        });
        finalUrl = safeUrl(page);
        return { run_id: runId, name: body.name, status: 'failed', steps, final_url: finalUrl };
      }
    }

    for (let i = 0; i < body.steps.length; i++) {
      const step = body.steps[i]!;
      const started = Date.now();
      try {
        const out = await execStep(page, step, body.base_url, resolveStepTimeout(step, body));
        steps.push({
          index: i,
          action: step.action,
          status: 'ok',
          ms: Date.now() - started,
          detail: out.detail,
          ...(out.resolved_via ? { resolved_via: out.resolved_via } : {}),
          ...(out.png ? { png: out.png, screenshot_run_id: randomUUID() } : {}),
        });
      } catch (err) {
        // Pin a failure screenshot so the caller sees the broken state.
        let png: Buffer | undefined;
        try {
          png = await page.screenshot();
        } catch {
          /* page may be gone — no shot */
        }
        steps.push({
          index: i,
          action: step.action,
          status: 'failed',
          ms: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
          ...(png ? { png, screenshot_run_id: randomUUID() } : {}),
        });
        finalUrl = safeUrl(page);
        return { run_id: runId, name: body.name, status: 'failed', steps, final_url: finalUrl };
      }
    }
    finalUrl = safeUrl(page);
    return { run_id: runId, name: body.name, status: 'passed', steps, final_url: finalUrl };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

function safeUrl(page: Page): string | undefined {
  try {
    return page.url();
  } catch {
    return undefined;
  }
}

/**
 * The four things an assert body can do. A verdict, an explosion, nothing at
 * all — or (F066) a plain object that LOOKS like a verdict and is not one.
 */
export type AssertOutcome =
  | { kind: 'syntax'; message: string }
  | { kind: 'threw'; message: string }
  | { kind: 'value'; value: boolean; detail?: string }
  /** A plain object carrying no `pass` key: the author asserted nothing. `keys`
   *  is what it DID carry — empty for `{}`, which is a different mistake. */
  | { kind: 'no-verdict'; keys: string[] };

/**
 * The sentence a `no-verdict` outcome deserves. Exported (0.6.1) because the
 * cardmem daemon and the cloud runner both surface this outcome on their own
 * paths, and they had each rebuilt the wording by hand — two copies of the
 * message, which is the same shape of mistake as the two copies of the verdict
 * logic that produced F064 in the first place. One definition, every caller.
 *
 * Naming the keys is the half that does the work: with them it is a one-line
 * fix, without them the author guesses.
 */
export function noVerdictMessage(keys: string[], body?: string): string {
  const tail = body ? `: ${body}` : '';
  return keys.length
    ? `assert returned an object with no 'pass' key (got: ${keys.join(', ')}) — did you mean { pass }? ` +
        `Return a boolean, or { pass, detail }${tail}`
    : `assert returned an empty object, so nothing was asserted — this is usually a template that was never ` +
        `filled in. Return a boolean, or { pass, detail }${tail}`;
}

/**
 * Compile + run an assert body INSIDE the page, and report which of three
 * things happened. (F064 — ported from cardmem's sealed `evalAssertBody`.)
 *
 * Serialised into the page by `page.evaluate(evalAssertBody, body)`, so the
 * compile, the run, and the `detail` stringification all happen page-side and
 * only a plain object crosses the boundary.
 *
 * Two wrappers, in order:
 *   1. expression — `x === y`, the common form
 *   2. block      — `return x === y`, which the docs also teach
 * Both async, so `await` works in either.
 */
export function evalAssertBody(b: string): Promise<AssertOutcome> {
  let fn: (() => Promise<unknown>) | null = null;
  let syntax = '';
  try {
    fn = new Function(`return (async () => (${b}))()`) as () => Promise<unknown>;
  } catch {
    try {
      fn = new Function(`return (async () => { ${b} })()`) as () => Promise<unknown>;
    } catch (e2) {
      syntax = e2 instanceof Error ? e2.message : String(e2);
    }
  }
  if (!fn) return Promise.resolve({ kind: 'syntax', message: syntax });

  return fn().then(
    (raw: unknown): AssertOutcome => {
      // The object form is HONOURED, not banned: read `.pass` when the value
      // carries one, keep bare-truthy behaviour otherwise (a querySelector
      // Element is a legitimate assert today and must keep working).
      if (raw !== null && typeof raw === 'object' && 'pass' in (raw as Record<string, unknown>)) {
        const r = raw as { pass?: unknown; detail?: unknown };
        let detail: string | undefined;
        if (r.detail !== undefined && r.detail !== null) {
          // Stringify HERE: a DOM node in `detail` would fail structured-clone
          // and turn a working assert into a mystery evaluate error.
          try {
            detail = typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail);
          } catch {
            detail = String(r.detail);
          }
        }
        return { kind: 'value', value: !!r.pass, ...(detail ? { detail } : {}) };
      }
      // F066 — a PLAIN object with no `pass` asserted nothing, and bare-truthy
      // made it green forever. `{passed:…}` `{ok:…}` `{found:…}` are all this.
      // The prototype is the discriminator: an Element, an array, a Date or a
      // class instance is not a plain object, so the fallback below still covers
      // `assert: document.querySelector('#x')`, which is why it exists.
      if (raw !== null && typeof raw === 'object') {
        const proto = Object.getPrototypeOf(raw);
        if (proto === Object.prototype || proto === null) {
          return { kind: 'no-verdict', keys: Object.keys(raw as Record<string, unknown>) };
        }
      }
      return { kind: 'value', value: !!raw };
    },
    (e: unknown): AssertOutcome => ({
      kind: 'threw',
      message: e instanceof Error ? e.message : String(e),
    }),
  );
}
