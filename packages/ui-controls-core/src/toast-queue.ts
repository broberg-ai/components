/**
 * A framework-neutral toast queue: push/dismiss/subscribe with auto-dismiss and
 * a visible cap. The React `<Toaster>` and Preact `<ToastProvider>` both drive
 * this so their behaviour is identical. Ids are a monotonic counter (no
 * `Math.random`/`Date.now`), which keeps it deterministic + test-friendly.
 */

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastInput {
  message: string;
  kind?: ToastKind;
  /** ms before auto-dismiss. `0` = sticky. Default: the queue's `defaultDuration`. */
  duration?: number;
}

export interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
  duration: number;
}

export interface ToastQueueOptions {
  /** Max toasts kept at once (oldest dropped). Default 4. */
  maxVisible?: number;
  /** Default auto-dismiss ms when a toast doesn't specify one. Default 4000. */
  defaultDuration?: number;
}

type TimerId = ReturnType<typeof setTimeout>;

export class ToastQueue {
  private items: ToastItem[] = [];
  private listeners = new Set<(items: ToastItem[]) => void>();
  private timers = new Map<string, TimerId>();
  private seq = 0;
  private readonly maxVisible: number;
  private readonly defaultDuration: number;

  constructor(opts: ToastQueueOptions = {}) {
    this.maxVisible = opts.maxVisible ?? 4;
    this.defaultDuration = opts.defaultDuration ?? 4000;
  }

  /** Current toasts (most-recent last). */
  get(): ToastItem[] {
    return this.items.slice();
  }

  push(input: ToastInput): string {
    const id = `t${++this.seq}`;
    const duration = input.duration ?? this.defaultDuration;
    const item: ToastItem = { id, message: input.message, kind: input.kind ?? "info", duration };
    this.items.push(item);
    // Enforce the visible cap by dropping the oldest.
    while (this.items.length > this.maxVisible) {
      const dropped = this.items.shift();
      if (dropped) this.clearTimer(dropped.id);
    }
    if (duration > 0) {
      this.timers.set(id, setTimeout(() => this.dismiss(id), duration));
    }
    this.emit();
    return id;
  }

  dismiss(id: string): void {
    const before = this.items.length;
    this.items = this.items.filter((t) => t.id !== id);
    this.clearTimer(id);
    if (this.items.length !== before) this.emit();
  }

  clear(): void {
    for (const id of this.timers.keys()) this.clearTimer(id);
    this.items = [];
    this.emit();
  }

  subscribe(listener: (items: ToastItem[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private clearTimer(id: string): void {
    const t = this.timers.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      this.timers.delete(id);
    }
  }

  private emit(): void {
    const snapshot = this.get();
    for (const l of this.listeners) l(snapshot);
  }
}
