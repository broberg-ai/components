import { useEffect, useRef, useState } from "react";
import { createPwaUpdater, type PwaUpdater, type PwaUpdaterOptions } from "./index.js";
import { optionsKey } from "./options-key.js";

/**
 * React binding for {@link createPwaUpdater}. Returns whether an update is
 * ready plus the `applyUpdate` action. The controller is created once and
 * torn down on unmount.
 */
export function usePwaUpdate(options: PwaUpdaterOptions = {}): {
  updateReady: boolean;
  applyUpdate: () => void;
} {
  // The effect's identity comes from the options the CALLER passed, so a new
  // core option needs no edit here. eslint's exhaustive-deps cannot see
  // through `key`; that is the trade, and it is the right way round.
  const key = optionsKey(options);
  const [updateReady, setUpdateReady] = useState(false);
  const updaterRef = useRef<PwaUpdater | null>(null);

  useEffect(() => {
    // THE WHOLE OBJECT, not a hand-picked subset. See options-key.ts: the
    // subset is what silently dropped `register` and `updateOnFocus`.
    const updater = createPwaUpdater(options);
    updaterRef.current = updater;
    setUpdateReady(updater.getState().updateReady);
    const unsubscribe = updater.subscribe((state) => setUpdateReady(state.updateReady));
    return () => {
      unsubscribe();
      updater.destroy();
      updaterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return {
    updateReady,
    applyUpdate: () => updaterRef.current?.applyUpdate(),
  };
}

export interface PwaUpdateBannerLabels {
  title?: string;
  body?: string;
  update?: string;
  dismiss?: string;
  close?: string;
}

const DEFAULT_LABELS: Required<PwaUpdateBannerLabels> = {
  title: "New version available",
  body: "Reload to get the latest version.",
  update: "Update",
  dismiss: "Later",
  close: "Close",
};

export interface PwaUpdateBannerProps {
  /** From `usePwaUpdate().updateReady`. Nothing renders when false. */
  updateReady: boolean;
  /** From `usePwaUpdate().applyUpdate`. */
  onUpdate: () => void;
  /** Optional dismiss handler (wired to both "Later" and the close ✕). */
  onDismiss?: () => void;
  /** Override any of the built-in strings (i18n). */
  labels?: PwaUpdateBannerLabels;
  /** Your class(es) — the skeleton carries NO colours or design-system styling. */
  className?: string;
}

/**
 * Unstyled, accessible "new version available" banner skeleton. It ships
 * structure + a11y + stable testids only; you own the look via `className`
 * and your design tokens. Prefer {@link usePwaUpdate} directly if you'd rather
 * build the UI yourself.
 */
export function PwaUpdateBanner({
  updateReady,
  onUpdate,
  onDismiss,
  labels,
  className,
}: PwaUpdateBannerProps) {
  if (!updateReady) return null;
  const l = { ...DEFAULT_LABELS, ...labels };
  const dismiss = () => onDismiss?.();
  return (
    <div role="status" aria-live="polite" data-testid="pwa-update-banner" className={className}>
      <p data-testid="pwa-update-title">{l.title}</p>
      {l.body ? <p data-testid="pwa-update-body">{l.body}</p> : null}
      <button type="button" data-testid="pwa-update-confirm" onClick={onUpdate}>
        {l.update}
      </button>
      <button type="button" data-testid="pwa-update-dismiss" onClick={dismiss}>
        {l.dismiss}
      </button>
      <button
        type="button"
        data-testid="pwa-update-close"
        aria-label={l.close}
        onClick={dismiss}
      >
        {"×"}
      </button>
    </div>
  );
}
