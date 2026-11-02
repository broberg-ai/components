// @broberg/chat/time — F079.15.6. Tell the model what day it is, in the reader's time zone, and
// turn a search engine's time window into the days it actually covers.
//
// Ported from broberg.ai's aidan.ts (nuLinje / periodeTekst, F043.3). Measured live 5/10 2026:
// Trail's timeWindow for «i dag» is 5/10 00:00 – 6/10 00:00 with an EXCLUSIVE end, and the model
// answered «6. oktober». A window ending at midnight ends on the day BEFORE.

export type TimeLocale = "da" | "en";

/** Default zone. A time without a zone is read in the reader's zone — so name it. */
export const DEFAULT_TIME_ZONE = "Europe/Copenhagen";

/**
 * One line for the end of a system prompt: today's date and time in `timeZone`, named, so the
 * model can answer «today», «yesterday» and any date. Never a server's UTC clock.
 */
export function nowLine(locale: TimeLocale, now: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" };
  if (locale === "en") {
    const s = now.toLocaleString("en-GB", opts);
    return `NOW: ${s} (${timeZone === DEFAULT_TIME_ZONE ? "Danish time, " : ""}${timeZone}). Use this for "today", "yesterday", "tomorrow" and any date.`;
  }
  const s = now.toLocaleString("da-DK", opts);
  return `NU: ${s} (${timeZone === DEFAULT_TIME_ZONE ? "dansk tid, " : ""}${timeZone}). Brug dette til «i dag», «i går», «i morgen» og enhver dato.`;
}

/**
 * A window «YYYY-MM-DD HH:MM» → «YYYY-MM-DD HH:MM» (local wall-clock times, as Trail sends them)
 * written as the WHOLE DAYS it covers. An end at exactly 00:00 is exclusive, so the last day is the
 * one before it. Unreadable input comes back unchanged — never a guessed date.
 */
export function periodText(from: string, to: string, locale: TimeLocale = "da"): string {
  const day = (s: string) => /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  const a = day(from), b = day(to);
  if (!a || !b) return `${from} – ${to}`;
  // The dates are wall-clock dates already, so they are named in UTC on purpose: no zone shift,
  // and no daylight-saving edge can move a day.
  const name = (y: number, m: number, d: number) =>
    new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale === "en" ? "en-GB" : "da-DK", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  let [by, bm, bd] = [Number(b[1]), Number(b[2]), Number(b[3])];
  if ((b[4] ?? "00") === "00" && (b[5] ?? "00") === "00") {
    const previous = new Date(Date.UTC(by, bm - 1, bd - 1));
    [by, bm, bd] = [previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate()];
  }
  const start = name(Number(a[1]), Number(a[2]), Number(a[3]));
  const end = name(by, bm, bd);
  if (start === end) return start;
  return locale === "en" ? `${start} up to and including ${end}` : `${start} til og med ${end}`;
}
