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

/**
 * Comparison key for overlap matching. cc updates lines IN PLACE while a turn
 * runs (spinner glyph rotates, "Worked for Xs" counts up, token counters tick)
 * — exact equality then finds no overlap and the whole frame gets re-appended
 * as a duplicate block (F078). Normalizing the volatile parts (one spinner
 * glyph, digit runs masked) makes those lines compare equal, and the merge
 * then REFRESHES them with the new frame's text.
 */
function norm(line: string): string {
  const t = line.replace(/\s+$/, "");
  // Only status lines (spinner-prefixed) get digit masking — masking digits in
  // ordinary output would make e.g. "line 1" equal "line 2" and eat real lines.
  if (/^[✻✶✳✢✽·•]/.test(t)) return `•${t.slice(1).replace(/\d+/g, "#")}`;
  return t;
}

export function mergeOverlap(hist: string[], body: string[]): string[] {
  const max = Math.min(hist.length, body.length);
  for (let k = max; k > 0; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) {
      if (norm(hist[hist.length - k + i]) !== norm(body[i])) {
        ok = false;
        break;
      }
    }
    // Take the NEW frame's lines for the overlapping segment so in-place
    // updates (timers, spinners) refresh instead of going stale.
    if (ok) return hist.slice(0, hist.length - k).concat(body);
  }
  // No suffix/prefix overlap. If the body is already CONTAINED in the recent
  // history (pure redraw or an SSE reconnect replaying the latest frame),
  // refresh that segment in place instead of appending a duplicate block.
  if (body.length > 0) {
    const windowStart = Math.max(0, hist.length - body.length * 2);
    for (let s = hist.length - body.length; s >= windowStart; s--) {
      let ok = true;
      for (let i = 0; i < body.length; i++) {
        if (norm(hist[s + i]) !== norm(body[i])) {
          ok = false;
          break;
        }
      }
      if (ok) return hist.slice(0, s).concat(body, hist.slice(s + body.length));
    }
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
