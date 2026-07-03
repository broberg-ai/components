// @broberg/lens-engine — storageState applied to a browser context.
//
// `applyStorageState` is the engine core (capture/flow both need it to navigate
// behind a login). `fetchStorageState` is an OPTIONAL consumer helper: a hosted
// service can call it to turn a mintEndpoint `{ url, secret }` into a
// storageState, then pass that to capture()/runFlow(). The engine core never
// calls fetchStorageState — it stays auth-agnostic. Request/response shape is 1:1
// with the fleet mint-endpoint contract (docs/LENS-MINT-ENDPOINT.md).

import type { BrowserContext } from 'playwright';
import { storageStateSchema, type MintAuth, type StorageState } from './schema';

/** OPTIONAL consumer helper — fetch a storageState from a target's mint endpoint
 *  using a caller-supplied secret. The engine core does NOT call this; a consumer
 *  uses it to build the `storageState` resolver it hands to capture()/runFlow(). */
export async function fetchStorageState(auth: MintAuth): Promise<StorageState> {
  if (!auth.secret) {
    throw new Error('mintEndpoint auth: `secret` is required to POST the mint endpoint');
  }
  const sendBody = auth.body != null;
  let res: Response;
  try {
    res = await fetch(auth.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.secret}`,
        Accept: 'application/json',
        ...(sendBody ? { 'Content-Type': 'application/json' } : {}),
        ...(auth.headers ?? {}),
      },
      ...(sendBody ? { body: JSON.stringify(auth.body) } : {}),
    });
  } catch (err) {
    throw new Error(`mintEndpoint auth: request to ${auth.url} failed: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) {
    throw new Error(`mintEndpoint auth: ${auth.url} returned ${res.status} ${res.statusText}`);
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    throw new Error(`mintEndpoint auth: ${auth.url} did not return JSON storageState: ${err instanceof Error ? err.message : err}`);
  }
  const parsed = storageStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`mintEndpoint auth: ${auth.url} returned a malformed storageState`);
  }
  const state = parsed.data;
  if (!state.cookies?.length && !state.origins?.length) {
    throw new Error(`mintEndpoint auth: ${auth.url} returned a storageState with no cookies/origins`);
  }
  return state;
}

/** Apply a Playwright storageState (cookies + localStorage) to a fresh context. */
export async function applyStorageState(context: BrowserContext, state: StorageState): Promise<void> {
  if (state.cookies?.length) {
    // storageState cookies already carry domain+path → addCookies takes them directly.
    await context.addCookies(state.cookies as unknown as Parameters<BrowserContext['addCookies']>[0]);
  }
  for (const o of state.origins ?? []) {
    const items = o.localStorage ?? [];
    if (!items.length) continue;
    await context.addInitScript(
      (payload: { origin: string; items: Array<{ name: string; value: string }> }) => {
        if (location.origin === payload.origin) {
          for (const it of payload.items) localStorage.setItem(it.name, it.value);
        }
      },
      { origin: o.origin, items },
    );
  }
}
