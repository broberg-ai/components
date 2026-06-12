/**
 * FrameAccumulator — the F071 scrollback engine as a tested pure class.
 *
 * cc runs on the terminal alt-screen, so tmux has no scrollback: every frame is
 * a full snapshot of the visible window. The accumulator splits each frame into
 * a volatile footer (cc's input box + statusline + spinner, rendered live) and
 * a body, then overlap-merges successive bodies so the dialogue that scrolls
 * off the top is retained.
 */
export interface FrameView {
  /** Accumulated dialogue lines (grows from the first fed frame). */
  history: string[];
  /** The volatile tail of the latest frame (input box / statusline / spinner). */
  footer: string[];
}

const RULE = /^[─━-]{10,}\s*$/;
const SPIN = /^[✻✶✳·•*]\s/;

export function splitFooter(lines: string[]): { body: string[]; footer: string[] } {
  let inp = -1;
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 8; i--) {
    const t = lines[i].replace(/\s+$/, "");
    if (t.charCodeAt(0) === 0x276f || t[0] === ">") {
      inp = i;
      break;
    }
  }
  let start: number;
  if (inp === -1) start = Math.max(0, lines.length - 3);
  else start = inp > 0 && RULE.test(lines[inp - 1].trim()) ? inp - 1 : inp;
  while (start > 0 && SPIN.test(lines[start - 1])) start--;
  return { body: lines.slice(0, start), footer: lines.slice(start) };
}

export function mergeOverlap(hist: string[], body: string[]): string[] {
  const max = Math.min(hist.length, body.length);
  for (let k = max; k > 0; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) {
      if (hist[hist.length - k + i] !== body[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return hist.concat(body.slice(k));
  }
  return hist.concat(body);
}

export class FrameAccumulator {
  private history: string[] = [];
  private footer: string[] = [];

  constructor(private readonly maxHistory = 5000) {}

  /** Feed a full frame snapshot; returns the updated view. */
  feed(content: string): FrameView {
    const lines = content.replace(/\s+$/, "").split("\n");
    const { body, footer } = splitFooter(lines);
    this.history = mergeOverlap(this.history, body);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
    this.footer = footer;
    return this.view;
  }

  get view(): FrameView {
    return { history: this.history, footer: this.footer };
  }

  /** Full rendered text (history + live footer). */
  get text(): string {
    return this.history.concat(this.footer).join("\n");
  }

  reset(): void {
    this.history = [];
    this.footer = [];
  }
}
