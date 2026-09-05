#!/usr/bin/env node
// F038.12 — every shipped roster row must be findable in Danish.
//
// CLAUDE.md orders every session to consult Discovery BEFORE building a
// capability, and to work in Danish. Those two instructions contradicted each
// other: measured 2026-09-05 across 30 capability words, ELEVEN Danish words
// returned nothing while their English equivalents returned 3 to 53 hits —
// betaling, billeder, logning, kalender, tidsplan, formular, faktura,
// abonnement, lagring, lyd, udrulning.
//
// The failure is not an empty list. It is a session concluding we have no
// Stripe package and wiring a raw Stripe SDK.
//
// WHY A COGNATE DOES NOT COUNT, and why this check would be theatre without
// that rule: `test`, `chat`, `session`, `video`, `sms` and `upload` are the same
// word in both languages. A row whose only "Danish" keyword is `test` is exactly
// as unfindable in Danish as one with no keywords at all — and a check that
// accepted it would report full coverage over the original defect.
import { DATA } from "./inventory-data.mjs";

/** Spelled the same in both languages, so they prove nothing about Danish. */
export const COGNATES = new Set([
  "test", "chat", "session", "video", "sms", "upload", "cookie", "cookies", "log",
  "mail", "e-mail", "push", "status", "data", "service", "app", "dashboard",
  "backup", "import", "export", "format", "api", "server", "client", "email",
  "monitor", "cron", "stripe", "design", "token", "tokens", "webhook", "widget",
  "browser", "database", "sdk", "cms", "seo", "i18n", "pwa", "url", "http",
]);

/** A keyword counts as Danish when it carries æ/ø/å, OR is a known Danish word
 *  that happens to use only ASCII (betaling, formular, faktura, lagring …).
 *  The list is explicit rather than clever: a heuristic that guesses would
 *  accept English words and quietly restore the defect. */
export const DANISH_ASCII = new Set([
  "betaling", "betalinger", "faktura", "abonnement", "kortbetaling", "udbetaling", "kasse",
  "billeder", "filer", "lagring", "mediearkiv", "objektlager", "filhaandtering", "filnavn",
  "logning", "logfiler", "fejl", "fejlsoegning", "serverlog", "hendelseslog", "aktivitetslog",
  "kalender", "tidsplan", "planlagt job", "planlaegning", "gentagende opgave",
  "formular", "kontaktformular", "spamfilter", "robotkontrol", "indsendelse",
  "tema", "farver", "designsystem", "typografi", "udseende",
  "konfiguration", "indstillinger", "miljoe", "miljoevariabler",
  "samtale", "chatbot", "dialog", "kundechat", "chatklient",
  "notifikation", "notifikationer", "underretning", "underretninger", "besked", "beskedliste",
  "hemmeligheder", "maskering", "adgangskoder", "adgangskode", "kodeord",
  "statistik", "enheder", "browsere", "malinger",
  "samtykke", "privatliv", "persondata", "cookiebanner",
  "knapper", "dialoger", "kontroller", "brugerflade",
  "genvej", "kommandopalet", "hurtigsoegning", "soegefelt",
  "sprog", "flersproget", "sprogvalg", "sprogskift",
  "metadata", "synlighed", "tale", "diktat", "udtale", "stemme", "ordbog",
  "tekstbesked", "mobilbesked", "afsender", "levering", "afsendelse",
  "kropskort", "smertekort", "kropsmodel", "smerter",
  "hjemmeskerm", "opdatering", "installerbar app",
  "database", "datalag", "forespoergsler", "dataadgang",
  "kunstig intelligens", "sprogmodel", "billedgenkendelse", "tekstgenerering",
  "overvagning", "nedbrud", "haendelser",
  "flade", "sessioner", "samarbejde", "kontrakter", "aftaler",
  "booking", "tidsbestilling", "redigering", "indholdsredigering", "tekstredigering",
  "download", "hentning", "svarhoveder", "aegthed", "mailkontrol", "forfalskning",
  "projektskabelon", "opstart", "stillads", "nyt projekt",
  "komprimering", "skalering", "billedkonvertering", "billedstoerrelse",
  "mailskabelon", "brevskabelon", "brevskal", "mailramme", "mailopsaetning",
  "nyhedsbrev", "udsendelse", "send mail",
  "profilbillede", "avatar", "brugerbillede",
  "vaerktoejsserver", "vaerktoejer", "noegler", "noegle", "noeglestyring",
  "revisionsspor", "sporbarhed", "soegbarhed", "soegning", "soegeord",
  "udrulning", "udgivelse", "driftsaetning", "idriftsaettelse",
  "aendringslog", "udgivelsesnoter", "nyheder", "versionsnoter",
  "lyd", "lydeffekter", "afspilning", "toner", "lydsignal",
  "stroemning", "viderestilling", "hurtighandlinger",
  "skaermbillede", "browsertest", "visuel kontrol", "visuel test", "browserstyring",
  "hastighedsbegraensning", "adgangsnoegle", "api-noegle",
  "talegenkendelse", "oversaettelse", "oversaet", "tale til tekst",
  "ansigt", "fingeraftryk", "biometri", "biometrisk", "sikkerhedsnoegle", "telefonkode",
]);

const fold = (s) => s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa");
const hasDanishChars = (s) => /[æøå]/i.test(s);

export function isDanish(kw) {
  const k = kw.toLowerCase().trim();
  if (COGNATES.has(k)) return false;
  if (hasDanishChars(k)) return true;
  return DANISH_ASCII.has(fold(k));
}

export function auditRoster(data = DATA) {
  const rows = [];
  for (const group of Object.values(data)) {
    for (const it of group.items ?? []) {
      if (!it.pkg) continue;                      // only rows a session can install
      const kw = it.kw ?? [];
      rows.push({ pkg: it.pkg, name: it.nm, danish: kw.filter(isDanish) });
    }
  }
  return { total: rows.length, missing: rows.filter((r) => r.danish.length === 0) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { total, missing } = auditRoster();
  if (total === 0) {
    console.error("::error::no roster rows found — refusing to report this as full coverage");
    process.exit(1);
  }
  if (missing.length) {
    console.error(`\n  ✗ ${missing.length} of ${total} roster row(s) have NO Danish keyword:\n`);
    for (const r of missing) console.error(`    ${r.pkg.padEnd(34)} ${r.name}`);
    console.error(`\n  A session searching in Danish cannot find these, and CLAUDE.md tells every`);
    console.error(`  session to search Discovery first AND to work in Danish. Add Danish keywords`);
    console.error(`  to kw:[…] in scripts/inventory-data.mjs, then rebuild the derived docs.`);
    console.error(`\n  A cognate does not count: test, chat, session, video, sms, upload are the`);
    console.error(`  same word in both languages and leave the row exactly as unfindable.\n`);
    process.exit(1);
  }
  console.log(`✓ all ${total} roster rows carry at least one non-cognate Danish keyword`);
}
