// components F110.8 — pseudonymisation before the analysis copy.
import { describe, expect, it } from "vitest";
import { MAX_RETENTION_MONTHS, createConversation, deleteExpired, keepUntil, pseudonymId, toAnalysisRecord, type AnalysisRecord } from "../src/pseudonymise";

const KEY = "k".repeat(40);
const OTHER_KEY = "o".repeat(40);

describe("AC1 — direct identifiers become keyed pseudonyms", () => {
  it("same value + same key → same pseudonym; a different key → a different one", async () => {
    const a = await pseudonymId("mette@example.dk", KEY, "email");
    expect(await pseudonymId("Mette@Example.dk ", KEY, "email")).toBe(a);
    expect(await pseudonymId("mette@example.dk", OTHER_KEY, "email")).not.toBe(a);
    expect(await pseudonymId("ole@example.dk", KEY, "email")).not.toBe(a);
  });
  it("the pseudonym does not contain the value, and an unkeyed hash of it does not match", async () => {
    const p = await pseudonymId("12345678", KEY, "phone");
    expect(p).not.toContain("12345678");
    const plain = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("phone\u000012345678")))].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(p).not.toContain(plain);
  });
  it("kind separates namespaces: an account id equal to a phone number is not linked", async () => {
    expect(await pseudonymId("12345678", KEY, "subject")).not.toBe(await pseudonymId("12345678", KEY, "phone"));
  });
  it("refuses a short key", async () => {
    await expect(pseudonymId("x", "short")).rejects.toThrow(/at least 32/);
  });
  it("in text: CPR removed, e-mail, phone and IP replaced — same value, same marker", async () => {
    const c = createConversation({ key: KEY });
    const r = await c.pseudonymise("Skriv til mette@example.dk eller ring 20 30 40 50. CPR 010190-1234. Fra 192.168.1.20 og igen mette@example.dk.");
    expect(r.text).not.toMatch(/mette@example\.dk|20 30 40 50|010190|192\.168\.1\.20/);
    expect(r.text).toContain("[CPR]");
    const emails = r.text.match(/\[EMAIL-[0-9a-f]+\]/g)!;
    expect(emails).toHaveLength(2);
    expect(emails[0]).toBe(emails[1]);
    expect(r.replaced).toMatchObject({ cpr: 1, email: 2, phone: 1, ip: 1 });
  });
});

describe("AC2 — names in free text", () => {
  it("a known name is replaced consistently through the conversation, incl. first name alone and genitive", async () => {
    const c = createConversation({ key: KEY, knownNames: ["Mette Jensen", "Ole Hansen"] });
    const a = await c.pseudonymise("Hej, jeg hedder Mette Jensen og skriver for Ole Hansen.");
    const b = await c.pseudonymise("Mettes kollega Ole ringer i morgen. MVH Mette");
    expect(a.text).toBe("Hej, jeg hedder [PERSON-1] og skriver for [PERSON-2].");
    expect(b.text).toBe("[PERSON-1]s kollega [PERSON-2] ringer i morgen. MVH [PERSON-1]");
  });
  it("two people who share a first name stay two people", async () => {
    const c = createConversation({ key: KEY, knownNames: ["Mette Jensen", "Mette Hansen"] });
    expect((await c.pseudonymise("Mette Jensen og Mette Hansen")).text).toBe("[PERSON-1] og [PERSON-2]");
  });
  it("a new conversation starts counting again", async () => {
    const one = createConversation({ key: KEY, knownNames: ["Ole Hansen"] });
    const two = createConversation({ key: KEY, knownNames: ["Mette Jensen"] });
    await one.pseudonymise("Ole Hansen");
    expect((await two.pseudonymise("Mette Jensen")).text).toBe("[PERSON-1]");
  });
  it("names it was not told about are NOT silently passed: notExamined says so", async () => {
    const r = await createConversation({ key: KEY, knownNames: ["Mette Jensen"] }).pseudonymise("Mette Jensen og Karin Lund");
    expect(r.text).toBe("[PERSON-1] og Karin Lund");
    expect(r.notExamined).toContain("names-not-known");
  });
  it("with a findNames step (e.g. an EU model), unknown names are replaced too, and the gap is no longer reported", async () => {
    const r = await createConversation({ key: KEY, findNames: async () => ["Karin Lund"] }).pseudonymise("Ring til Karin Lund.");
    expect(r.text).toBe("Ring til [PERSON-1].");
    expect(r.notExamined).not.toContain("names-not-known");
  });
  it("does not match a name inside another word", async () => {
    const r = await createConversation({ key: KEY, knownNames: ["Ole"] }).pseudonymise("Skolen og Ole");
    expect(r.text).toBe("Skolen og [PERSON-1]");
  });

  // Measured recall on a Danish corpus — the names the system knows (sender + case parties),
  // in the forms people actually write them. Recorded in docs/legal/pseudonymisation-standards.md.
  const CORPUS: [string, string[]][] = [
    ["Hej, mit navn er Mette Jensen.", ["Mette Jensen"]],
    ["Mette Jensen har bestilt tid.", ["Mette Jensen"]],
    ["Kan Mette få en ny tid?", ["Mette Jensen"]],
    ["Det er Mettes datter der ringer.", ["Mette Jensen"]],
    ["MVH Mette", ["Mette Jensen"]],
    ["mette jensen skrev i går", ["Mette Jensen"]],
    ["Jensen, Mette — faktura 2211", ["Mette Jensen"]],
    ["Ole Hansen og Mette Jensen kommer begge.", ["Ole Hansen", "Mette Jensen"]],
    ["Hansens bil holder udenfor.", ["Ole Hansen"]],
    ["Spørg Ole om nøglen.", ["Ole Hansen"]],
    ["Anne-Marie Holm er kontaktperson.", ["Anne-Marie Holm"]],
    ["Hej Anne-Marie, tak for sidst.", ["Anne-Marie Holm"]],
    ["Søren Østergaard ringede.", ["Søren Østergaard"]],
    ["Østergaards mail kom ikke frem.", ["Søren Østergaard"]],
    ["Til: Peter  Nielsen", ["Peter Nielsen"]],
    ["Peter.Nielsen har ikke svaret.", ["Peter Nielsen"]],
  ];
  it("recall on the Danish corpus of known names is at least 90 % (measured value printed)", async () => {
    let names = 0, found = 0;
    for (const [sentence, known] of CORPUS) {
      const r = await createConversation({ key: KEY, knownNames: known }).pseudonymise(sentence);
      const left = known.flatMap((n) => n.split(/\s+/)).filter((part) => new RegExp(`(?<![\\p{L}])${part}`, "iu").test(r.text));
      names += 1;
      if (left.length === 0) found += 1;
    }
    const recall = found / names;
    console.log(`F110.8 known-name recall on Danish corpus: ${found}/${names} = ${(recall * 100).toFixed(0)} %`);
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });
});

describe("AC3 — art. 9: health never reaches the copy unless consented", () => {
  it("a health sentence is removed; the rest stays", async () => {
    const r = await createConversation({ key: KEY }).pseudonymise("Jeg vil gerne flytte min tid. Jeg har haft ondt i ryggen siden min operation. Tak.");
    expect(r.text).toBe("Jeg vil gerne flytte min tid. [HELBRED FJERNET] Tak.");
    expect(r.replaced.health).toBe(1);
    expect(r.notExamined).toContain("health-beyond-keywords");
  });
  it("with explicit consent the content stays (part 4 of the owner's model)", async () => {
    const r = await createConversation({ key: KEY, health: "consented" }).pseudonymise("Jeg har haft ondt i ryggen.");
    expect(r.text).toBe("Jeg har haft ondt i ryggen.");
  });
});

describe("AC4 — every record carries its deadline; expired ones are deleted", () => {
  it("keepUntil is at most 6 months after collection, and a longer retention is refused", () => {
    expect(keepUntil(new Date("2026-11-02T10:00:00Z")).toISOString()).toBe("2027-05-02T10:00:00.000Z");
    expect(keepUntil(new Date("2026-08-31T10:00:00Z")).toISOString()).toBe("2027-02-28T10:00:00.000Z");
    expect(() => keepUntil(new Date(), MAX_RETENTION_MONTHS + 1)).toThrow(/1–6 months/);
  });

  it("a record holds a pseudonymised subject + text and its deadline; deleteExpired removes it after — read back from the store", async () => {
    const rows = new Map<string, AnalysisRecord>();
    const store = {
      async listExpired(now: Date) { return [...rows.values()].filter((r) => new Date(r.keepUntil) <= now).map((r) => r.id); },
      async delete(ids: string[]) { for (const id of ids) rows.delete(id); },
    };
    const c = createConversation({ key: KEY, knownNames: ["Mette Jensen"] });
    const old = await toAnalysisRecord({ id: "r1", subjectId: "user-42", text: "Mette Jensen spurgte om priser.", collectedAt: new Date("2026-01-01T00:00:00Z") }, c, KEY);
    const recent = await toAnalysisRecord({ id: "r2", subjectId: "user-42", text: "Hej igen.", collectedAt: new Date("2026-06-01T00:00:00Z") }, c, KEY);
    rows.set(old.id, old); rows.set(recent.id, recent);

    expect(old.subject).toBe(recent.subject);
    expect(old.subject).not.toContain("user-42");
    expect(old.text).toBe("[PERSON-1] spurgte om priser.");
    expect(old.keepUntil).toBe("2026-07-01T00:00:00.000Z");

    expect(await deleteExpired(store, new Date("2026-06-30T23:59:59Z"))).toBe(0);
    expect(await deleteExpired(store, new Date("2026-07-01T00:00:00Z"))).toBe(1);
    expect([...rows.keys()]).toEqual(["r2"]);
  });
});
