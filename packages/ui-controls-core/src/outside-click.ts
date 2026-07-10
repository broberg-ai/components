/**
 * Close-on-outside-interaction wiring for portal menus (custom-select, date
 * popover). Fires `onClose` when a pointer lands outside every registered
 * element, or on an ancestor scroll / window resize (a fixed-position portal
 * would otherwise float away from its trigger). SSR-safe.
 */

/** Pure predicate: is `target` outside ALL of `els`? (null els are ignored.) */
export function isOutsideAll(target: EventTarget | null, els: Array<Element | null | undefined>): boolean {
  if (!(target instanceof Node)) return true;
  for (const el of els) {
    if (el && el.contains(target)) return false;
  }
  return true;
}

export interface OutsideClickHandle {
  attach(): void;
  detach(): void;
}

/**
 * `getEls()` is called lazily on each event so refs can populate after mount.
 * `attach()`/`detach()` are idempotent.
 */
export function makeOutsideClickHandler(
  getEls: () => Array<Element | null | undefined>,
  onClose: () => void,
): OutsideClickHandle {
  const doc = (globalThis as unknown as { document?: Document }).document;
  const win = (globalThis as unknown as { addEventListener?: typeof window.addEventListener }) as Window | undefined;
  let attached = false;

  const onPointerDown = (e: Event): void => {
    if (isOutsideAll(e.target, getEls())) onClose();
  };
  const onScrollOrResize = (): void => onClose();

  return {
    attach() {
      if (attached || !doc) return;
      attached = true;
      doc.addEventListener("pointerdown", onPointerDown, true);
      // Capture-phase scroll catches ancestor scroll containers too.
      doc.addEventListener("scroll", onScrollOrResize, true);
      win?.addEventListener?.("resize", onScrollOrResize);
    },
    detach() {
      if (!attached || !doc) return;
      attached = false;
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("scroll", onScrollOrResize, true);
      win?.removeEventListener?.("resize", onScrollOrResize);
    },
  };
}
