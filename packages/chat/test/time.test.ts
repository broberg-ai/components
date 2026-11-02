// F079.15.6 — ported from broberg.ai's src/aidan-tid.test.ts (nuLinje/periodeTekst cases), plus DST.
import { describe, expect, it } from "vitest";
import { nowLine, periodText } from "../src/time";

describe("nowLine (ported: nuLinje)", () => {
  it("winter time: 23:30Z on 21 January is 00:30 on the 22nd in Copenhagen", () => {
    const s = nowLine("da", new Date("2026-01-21T23:30:00Z"));
    expect(s).toContain("22. januar 2026");
    expect(s).toContain("00.30");
    expect(s).toContain("dansk tid");
  });
  it("summer time: 22:30Z on 21 July is 00:30 on the 22nd (UTC+2, not +1)", () => {
    const s = nowLine("da", new Date("2026-07-21T22:30:00Z"));
    expect(s).toContain("onsdag den 22. juli 2026");
    expect(s).toContain("00.30");
  });
  it("an English page gets an English line in the same zone", () => {
    const s = nowLine("en", new Date("2026-10-05T11:15:00Z"));
    expect(s).toContain("Monday, 5 October 2026");
    expect(s).toContain("13:15");
    expect(s).toContain("Danish time");
  });
  it("the zone is named on the line, and another zone is honoured", () => {
    expect(nowLine("da", new Date("2026-10-05T11:15:00Z"))).toContain("Europe/Copenhagen");
    expect(nowLine("en", new Date("2026-10-05T11:15:00Z"), "UTC")).toContain("11:15");
  });
});

describe("periodText (ported: periodeTekst)", () => {
  it("«i dag» from Trail (end = next midnight) is ONE day — not the next (measured 5/10: «6. oktober»)", () => {
    expect(periodText("2026-10-05 00:00", "2026-10-06 00:00")).toBe("mandag den 5. oktober 2026");
  });
  it("several days: the last day included, not the midnight after", () => {
    expect(periodText("2026-09-21 00:00", "2026-10-05 00:00")).toBe("mandag den 21. september 2026 til og med søndag den 4. oktober 2026");
  });
  it("an end that is not midnight (Trail's «i går» ends 23:59) stays that day", () => {
    expect(periodText("2026-10-04 00:00", "2026-10-04 23:59")).toBe("søndag den 4. oktober 2026");
  });
  it("unreadable → unchanged", () => {
    expect(periodText("snart", "senere")).toBe("snart – senere");
  });
  it("across the switch to winter time (25 Oct 2026, a 25-hour day) a day is still one day", () => {
    expect(periodText("2026-10-25 00:00", "2026-10-26 00:00")).toBe("søndag den 25. oktober 2026");
  });
  it("across the switch to summer time (29 Mar 2026, a 23-hour day) a day is still one day", () => {
    expect(periodText("2026-03-29 00:00", "2026-03-30 00:00")).toBe("søndag den 29. marts 2026");
  });
  it("English", () => {
    expect(periodText("2026-09-21 00:00", "2026-10-05 00:00", "en")).toBe("Monday, 21 September 2026 up to and including Sunday, 4 October 2026");
  });
});
