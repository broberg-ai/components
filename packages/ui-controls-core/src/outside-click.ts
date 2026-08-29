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
  /**
   * F016.7 — a scroll from INSIDE a registered element is not the outside world.
   *
   * The capture-phase listener below is deliberate and stays: scroll events do
   * not bubble, so capture is the only way to see an ANCESTOR scroll container,
   * and a fixed-position portal must close when the page scrolls beneath it or
   * it floats away from its trigger.
   *
   * But capture also sees every scroll from every DESCENDANT, and this handler
   * used to close unconditionally — so a popover with a scrollable list closed
   * itself the moment the user scrolled it. Measured on a panel with an inner
   * list: onClose fired once where it should have fired zero times. The
   * pointerdown path already asked `isOutsideAll`; this one never did.
   *
   * Nobody had reported it, which is what this defect looks like from outside:
   * a select that closes while you scroll reads as a slip of the finger.
   */
  const onScroll = (e: Event): void => {
    if (isOutsideAll(e.target, getEls())) onClose();
  };
  /** A resize has no target inside anything, so it never asks. */
  const onResize = (): void => onClose();

  return {
    attach() {
      if (attached || !doc) return;
      attached = true;
      doc.addEventListener("pointerdown", onPointerDown, true);
      // Capture-phase scroll catches ancestor scroll containers too.
      doc.addEventListener("scroll", onScroll, true);
      win?.addEventListener?.("resize", onResize);
    },
    detach() {
      if (!attached || !doc) return;
      attached = false;
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("scroll", onScroll, true);
      win?.removeEventListener?.("resize", onResize);
    },
  };
}
