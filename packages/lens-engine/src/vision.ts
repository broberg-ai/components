// @broberg/lens-engine — vision fallback locator (the flow's last-resort layer).
//
// When the DOM layers (testid/css/role/label/placeholder/text) all miss AND a
// LocateSpec carries a `vision` description, we locate the element by VISION —
// but NOT by raw coordinate grounding (proven unreliable: even strong models
// mis-place a clearly-drawn button by ~50px, and an off-target click would
// violate "never guess/submit"). Instead we use **Set-of-Marks**:
//   1. enumerate the visible interactive elements + tag each (data-lens-mark=N)
//   2. draw numbered badges + screenshot
//   3. ask the model WHICH NUMBER matches the description (label-picking — which
//      models do reliably, unlike coordinates)
//   4. return the REAL DOM element for mark N → every action clicks/fills its
//      exact centre. Coordinate imprecision disappears.
// If no candidate matches, the model returns null → clean failure (never a guess).
//
// Routed through @broberg/ai-sdk — NEVER a raw provider SDK. Default route =
// Mistral EU (GDPR-safe): a screenshot can carry personal/health data, so the
// SAFE, EU-hosted route (Mistral, Paris) is the DEFAULT and any non-EU model is
// a deliberate, informed opt-in — never the reverse. Env-overridable:
//   LENS_VISION_PROVIDER (default 'mistral')  ·  LENS_VISION_MODEL (default 'mistral-large-latest')
// For a page you KNOW is PII-free (e.g. a developer's own store-console UI) you
// may consciously opt into a non-EU label-reader:
//   LENS_VISION_PROVIDER=openrouter  LENS_VISION_MODEL=google/gemini-2.5-flash
//
// SHIPS DARK: inert unless LENS_VISION_ENABLED=1 AND a provider key is set.

import { createAI, parseJsonLoose } from '@broberg/ai-sdk';
import type { Locator, Page } from 'playwright';

/** Max interactive elements to mark — keeps the screenshot legible + the prompt small. */
const MAX_MARKS = 80;

/** The vision route (provider + model), env-overridable. Default = Mistral EU
 *  (GDPR-safe) — a screenshot can carry PII, so the safe EU route is the default
 *  and any non-EU model is an explicit LENS_VISION_PROVIDER opt-in. */
export function visionRoute(): { provider: string; model: string } {
  return {
    provider: process.env.LENS_VISION_PROVIDER ?? 'mistral',
    model: process.env.LENS_VISION_MODEL ?? 'mistral-large-latest',
  };
}

/** Ships dark: the explicit enable AND some supported provider key must be set. */
export function visionEnabled(): boolean {
  return (
    process.env.LENS_VISION_ENABLED === '1' &&
    Boolean(process.env.OPENROUTER_API_KEY || process.env.MISTRAL_API_KEY)
  );
}

let _ai: ReturnType<typeof createAI> | null = null;
function ai(): ReturnType<typeof createAI> {
  return (_ai ??= createAI());
}

/** In-page: tag every visible interactive element with data-lens-mark=N and draw
 *  a numbered badge at its top-left. Returns how many were marked. Runs in the
 *  browser — no imports, self-contained. */
function markInteractive(cap: number): number {
  const SEL = [
    'a[href]',
    'button',
    'input:not([type=hidden])',
    'select',
    'textarea',
    '[role=button]',
    '[role=link]',
    '[role=tab]',
    '[role=menuitem]',
    '[role=checkbox]',
    '[role=radio]',
    '[role=textbox]',
    '[role=combobox]',
    '[role=switch]',
    '[contenteditable=""]',
    '[contenteditable=true]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let n = 0;
  for (const el of Array.from(document.querySelectorAll(SEL))) {
    if (n >= cap) break;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    el.setAttribute('data-lens-mark', String(n));
    const badge = document.createElement('div');
    badge.className = '__lens_som';
    badge.textContent = String(n);
    const s = badge.style;
    s.position = 'fixed';
    s.left = `${Math.max(0, r.left)}px`;
    s.top = `${Math.max(0, r.top)}px`;
    s.zIndex = '2147483647';
    s.background = '#e11d48';
    s.color = '#fff';
    s.font = 'bold 13px monospace';
    s.padding = '0 3px';
    s.borderRadius = '3px';
    s.lineHeight = '16px';
    s.pointerEvents = 'none';
    document.body.appendChild(badge);
    n++;
  }
  return n;
}

/** In-page: remove the badge overlays (keep the data-lens-mark tags for the click). */
function clearBadges(): void {
  for (const b of Array.from(document.querySelectorAll('.__lens_som'))) b.remove();
}

/** Locate a UI element by natural-language description via Set-of-Marks → the REAL
 *  DOM Locator for the matched element. Throws (clean, never a guess) when the
 *  model matches nothing. */
export async function resolveVisionElement(page: Page, description: string): Promise<Locator> {
  const count = await page.evaluate(markInteractive, MAX_MARKS);
  if (count === 0) {
    await page.evaluate(clearBadges).catch(() => {});
    throw new Error(`vision: no interactive candidates on the page to match "${description}"`);
  }
  let res;
  try {
    const shot = await page.screenshot(); // Node Buffer → copy to a fresh Uint8Array for the SDK's strict type
    res = await ai().vision({
      image: Uint8Array.from(shot),
      mimeType: 'image/png',
      system: 'You match a described UI element to a numbered red badge in a screenshot. Return ONLY JSON, never prose.',
      prompt:
        `The interactive elements are labeled with red numbered badges (0-${count - 1}) at their top-left corners. ` +
        `Which badge number marks this element: "${description}"? ` +
        `Return ONLY compact JSON {"n":<int>} with that badge number, or {"n":null} if none of them is it.`,
      override: visionRoute(),
      purpose: 'lens-engine vision set-of-marks',
    });
  } finally {
    await page.evaluate(clearBadges).catch(() => {});
  }
  const parsed = parseJsonLoose(res.text) as { n?: number | null } | null;
  const n = parsed?.n;
  if (typeof n !== 'number' || Number.isNaN(n) || n < 0 || n >= count) {
    throw new Error(`vision: could not match "${description}" among ${count} elements (model: ${JSON.stringify(res.text).slice(0, 120)})`);
  }
  console.log(`[lens-engine] vision "${description}" → mark #${n} of ${count} (route ${visionRoute().provider}/${visionRoute().model})`);
  return page.locator(`[data-lens-mark="${n}"]`).first();
}
