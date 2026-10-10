// F017.1 — the settings dirty-bus and two small helpers, framework-free.
//
// Lifted from cms (packages/cms-admin/src/components/settings/, where the bus is a
// set of window CustomEvents "cms:settings-dirty|save|saved"), with two changes
// the cms version needed and did not have:
//
//  1. A save can FAIL. cms reset its Save button after a fixed 5 s whether or not
//     anything was stored, so a failed save looked like a finished one. Here a
//     save handler that throws or rejects leaves the form dirty and reports the
//     error — "Saved" is only said when every panel actually saved.
//  2. requestSave() waits for EVERY panel. A settings page has several panels and
//     one Save button; cms's first panel to answer flipped the button to clean
//     while the others were still writing.
//
// A plain in-memory bus, not window events: the Save button and the panels live in
// the same app bundle, so a module-level bus reaches across component subtrees
// exactly as window events did, and it imports no browser global — it loads in
// Node, Bun and a worker without a DOM.

export type SaveHandler = () => void | Promise<void>;

export interface DirtyBusHandlers {
  /** Something changed and is not saved yet. */
  onDirty?: () => void;
  /** Save was requested: write your part. Throw or reject to fail the save. */
  onSave?: SaveHandler;
  /** Every panel saved; the form is clean again. */
  onSaved?: () => void;
  /** A save handler failed; the form stays dirty. */
  onSaveFailed?: (error: unknown) => void;
  /** Any state change — the hook for a UI that renders `getState()`. */
  onChange?: (state: DirtyState) => void;
}

export interface DirtyState {
  dirty: boolean;
  saving: boolean;
  /** The last save's error, cleared by the next change or a successful save. */
  error: unknown;
}

export interface DirtyBus {
  markDirty(): void;
  markSaved(): void;
  /** Run every onSave handler and wait for all of them. Resolves true when all saved. */
  requestSave(): Promise<boolean>;
  onDirtyBus(handlers: DirtyBusHandlers): () => void;
  getState(): DirtyState;
}

/** A bus of its own — for a second, independent form on the same page, and for tests. */
export function createDirtyBus(): DirtyBus {
  const subs = new Set<DirtyBusHandlers>();
  let state: DirtyState = { dirty: false, saving: false, error: undefined };
  const set = (next: Partial<DirtyState>) => {
    state = { ...state, ...next };
    for (const s of [...subs]) s.onChange?.(state);
  };
  const bus: DirtyBus = {
    markDirty() {
      set({ dirty: true, error: undefined });
      for (const s of [...subs]) s.onDirty?.();
    },
    markSaved() {
      set({ dirty: false, saving: false, error: undefined });
      for (const s of [...subs]) s.onSaved?.();
    },
    async requestSave() {
      if (state.saving) return false;
      set({ saving: true, error: undefined });
      const results = await Promise.allSettled([...subs].map(async (s) => s.onSave?.()));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) {
        set({ saving: false, error: failed.reason });
        for (const s of [...subs]) s.onSaveFailed?.(failed.reason);
        return false;
      }
      bus.markSaved();
      return true;
    },
    onDirtyBus(handlers) {
      subs.add(handlers);
      return () => {
        subs.delete(handlers);
      };
    },
    getState: () => state,
  };
  return bus;
}

/** The page's bus. Components default to it, so a Save button and its panels meet without wiring. */
export const settingsBus: DirtyBus = createDirtyBus();

export const markDirty = (): void => settingsBus.markDirty();
export const markSaved = (): void => settingsBus.markSaved();
export const requestSave = (): Promise<boolean> => settingsBus.requestSave();
export const onDirtyBus = (handlers: DirtyBusHandlers): (() => void) => settingsBus.onDirtyBus(handlers);

/** A random secret as lowercase hex: `byteLength` bytes → twice as many characters. */
export function generateSecret(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Copy text. Resolves true when copied, false — never a throw — when the Clipboard
 * API is missing or refuses (insecure origin, no permission). On success `onReset`
 * runs after `resetMs` (1500 ms, as in cms), the moment a "Copied" mark goes back.
 */
export async function copyToClipboard(text: string, opts: { onReset?: () => void; resetMs?: number } = {}): Promise<boolean> {
  const clip = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator?.clipboard;
  if (!clip?.writeText) return false;
  try {
    await clip.writeText(text);
  } catch {
    return false;
  }
  if (opts.onReset) setTimeout(opts.onReset, opts.resetMs ?? 1500);
  return true;
}
