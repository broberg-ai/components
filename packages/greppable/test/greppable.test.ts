import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkGreppable, nonTextRatio, unsearchableReason } from "../src/index";

const NUL = Buffer.from([0x00]);
const OE = Buffer.from([0xf8]); // latin-1 'ø' — a single byte, and not valid UTF-8
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A throwaway git repo — the real thing, because checkGreppable asks git which
 *  files are tracked and a stub for that would test the stub. */
function repo(files: Record<string, string | Buffer>): string {
  const cwd = mkdtempSync(join(tmpdir(), "greppable-"));
  dirs.push(cwd);
  execFileSync("git", ["init", "-q"], { cwd });
  for (const [name, content] of Object.entries(files)) {
    const dir = name.includes("/") ? join(cwd, name.slice(0, name.lastIndexOf("/"))) : cwd;
    if (dir !== cwd) mkdirSync(dir, { recursive: true });
    writeFileSync(join(cwd, name), content);
  }
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "t"], { cwd });
  return cwd;
}

describe("the union — both halves, because each looks like the fix for the other", () => {
  it("catches a NUL file, AND that file decodes as valid UTF-8", () => {
    // The second assertion is the point. U+0000 is a legal code point, so a
    // decoder-only guard clears this file — it was measured green on exactly
    // this case for twenty minutes in another repo. Pinning it here means a
    // future 'simplification' to TextDecoder alone cannot pass.
    const content = Buffer.concat([Buffer.from("const SEP='"), NUL, Buffer.from("';\nexport const x=1;\n")]);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(content)).not.toThrow();

    const r = checkGreppable({ cwd: repo({ "nul.ts": content }) });
    expect(r.offenders.map((o) => o.file)).toEqual(["nul.ts"]);
    expect(r.offenders[0]!.kind).toBe("nul");
    expect(r.offenders[0]!.at).toBe(11);
    expect(r.ok).toBe(false);
  });

  it("catches a latin-1 file with no NUL anywhere, with its byte offset", () => {
    const content = Buffer.concat([Buffer.from("// Bl"), OE, Buffer.from("dgjort\nexport const x=1;\n")]);
    expect(content.indexOf(0)).toBe(-1); // no NUL — the NUL check alone misses this

    const r = checkGreppable({ cwd: repo({ "latin1.ts": content }) });
    expect(r.offenders.map((o) => o.file)).toEqual(["latin1.ts"]);
    expect(r.offenders[0]!.kind).toBe("utf8");
    expect(r.offenders[0]!.at).toBe(5);
  });

  it("does NOT flag clean UTF-8 containing Danish characters", () => {
    // Without this, `return true` satisfies both cases above.
    const r = checkGreppable({ cwd: repo({ "ok.ts": "// Blødgjort æøå\nexport const x=1;\n" }) });
    expect(r.offenders).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("exemption needs BOTH a signature and genuinely binary bytes", () => {
  it("exempts a real PNG and reports its ratio rather than dropping it", () => {
    const r = checkGreppable({ cwd: repo({ "logo.png": PNG_1x1, "ok.ts": "export const x=1;\n" }) });
    expect(r.offenders).toEqual([]);
    expect(r.exempt.map((e) => e.file)).toEqual(["logo.png"]);
    expect(r.exempt[0]!.format).toBe("png");
    expect(r.exempt[0]!.ratio).toBeGreaterThan(0.1);
    expect(r.ok).toBe(true);
  });

  it("catches a TEXT file wearing a binary signature, and says which test disagreed", () => {
    // A latin-1 note about PDF headers: first four bytes are literally %PDF, so
    // the signature table alone excuses it — measured, not hypothesised. The
    // guard reported "every tracked text file is searchable" while this file was
    // invisible to grep.
    const content = Buffer.concat([Buffer.from("%PDF header notes\n\nEn s"), OE, Buffer.from("rlig fil.\n")]);
    const r = checkGreppable({ cwd: repo({ "about-pdf.md": content }) });

    expect(r.offenders.map((o) => o.file)).toEqual(["about-pdf.md"]);
    // Both facts survive onto the offender so the CLI can explain the near-miss:
    // the signature matched, and the bytes say text anyway.
    expect(r.offenders[0]!.format).toBe("pdf");
    expect(r.offenders[0]!.ratio).toBeLessThan(0.1);
    expect(r.exempt).toEqual([]);
  });
});

describe("the check proves its own coverage", () => {
  it("scanned + skipped === tracked, with no gap", () => {
    const r = checkGreppable({ cwd: repo({ "a.ts": "export const a=1;\n", "b/c.ts": "export const c=1;\n" }) });
    expect(r.scanned + r.skipped.length).toBe(r.tracked);
    expect(r.coverageGap).toBe(0);
  });

  it("counts and NAMES a tracked symlink instead of swallowing it, and is not ok", () => {
    const cwd = repo({ "real.ts": "export const x=1;\n" });
    symlinkSync("real.ts", join(cwd, "link.ts"));
    execFileSync("git", ["add", "-A"], { cwd });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "l"], { cwd });

    const r = checkGreppable({ cwd });
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toContain("link.ts");
    expect(r.skipped[0]).toContain("not a regular file");
    // A run that could not read everything is NOT a clean run, even with zero
    // offenders — that is the whole failure class this package exists to expose.
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([]);
    expect(r.coverageGap).toBe(0);
  });
});

describe("the predicates in isolation", () => {
  it("unsearchableReason checks NUL FIRST — order is not cosmetic", () => {
    const nulOnly = Buffer.concat([Buffer.from("a"), NUL, Buffer.from("b")]);
    const latin1Only = Buffer.concat([Buffer.from("a"), OE, Buffer.from("b")]);
    expect(unsearchableReason(nulOnly)).toEqual({ kind: "nul", at: 1 });
    expect(unsearchableReason(latin1Only)).toEqual({ kind: "utf8", at: 1 });
    expect(unsearchableReason(Buffer.from("ren æøå tekst"))).toBeNull();
  });

  it("separates the two populations the threshold sits between", () => {
    const lookalike = Buffer.concat([Buffer.from("%PDF notes\nEn s"), OE, Buffer.from("rlig fil.\n")]);
    expect(nonTextRatio(lookalike)).toBeLessThan(0.1);
    expect(nonTextRatio(PNG_1x1)).toBeGreaterThan(0.1);
  });
});

describe("non-ASCII filenames (fd-sundhed, against 0.1.0)", () => {
  // git's default core.quotepath=true C-QUOTES any path with a non-ASCII byte,
  // INCLUDING the surrounding double quotes — so `git ls-files` returned the
  // literal string "…/Blå.eps" (quotes and backslash escapes and all) and lstat
  // on that is ENOENT while the file sits on disk. RED against 0.1.0.
  //
  // Their measurement killed the plausible explanation: one of the two failing
  // files was NFD on disk and the other NFC, and BOTH failed — so Unicode
  // normalisation could not be the cause.
  it("a file with æøå in its NAME is scanned, not reported as unreadable", () => {
    const dir = repo({
      "logo-Blå.txt": "helt almindelig tekst\n",
      "rapport-Ø.md": "# overskrift\n",
      "plain.ts": "const a = 1;\n",
    });
    const r = checkGreppable({ cwd: dir });

    expect(r.skipped).toEqual([]);
    expect(r.scanned).toBe(3);
    expect(r.tracked).toBe(3);
    expect(r.coverageGap).toBe(0);
    expect(r.offenders).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("a non-ASCII name does not hide a REAL offender behind it", () => {
    // The dangerous version of the same bug: if the path cannot be read, a file
    // that genuinely is grep-invisible is reported as "unreadable" instead of as
    // an offender — a different error, sending the reader somewhere else.
    const dir = repo({ "data-Blå.ts": 'const s = "a\0b";\n' });
    const r = checkGreppable({ cwd: dir });

    expect(r.skipped).toEqual([]);
    expect(r.offenders).toHaveLength(1);
    expect(r.offenders[0]!.file).toContain("Bl");
    expect(r.offenders[0]!.kind).toBe("nul");
  });
});

describe("a run that read NOTHING must not report clean (torrent-search-api)", () => {
  // They sharpened our own rule against us. `scanned + skipped === tracked`
  // holds on an EMPTY list (0 + 0 === 0), so the coverage invariant cannot catch
  // a run that never looked. Measured on 0.1.1: "scanned 0 of 0 tracked files /
  // Every tracked text file is searchable" and exit 0.
  it("an empty repo is NOT ok", () => {
    // Built without the `repo()` helper on purpose: git refuses to commit an
    // empty tree, and `git ls-files` answers fine on an initialised repo with no
    // commits — which is exactly the state under test.
    const dir = mkdtempSync(join(tmpdir(), "greppable-empty-"));
    dirs.push(dir);
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const r = checkGreppable({ cwd: dir });

    expect(r.tracked).toBe(0);
    expect(r.scanned).toBe(0);
    expect(r.coverageGap).toBe(0); // the old invariant is still satisfied…
    expect(r.offenders).toEqual([]);
    expect(r.ok).toBe(false); // …and this is what it could never say
  });

  it("a repo with files IS ok — so the new clause did not just break everything", () => {
    // The negative control. Without it, `ok: false` would satisfy the test above.
    const dir = repo({ "a.ts": "const a = 1;\n" });
    const r = checkGreppable({ cwd: dir });
    expect(r.scanned).toBe(1);
    expect(r.ok).toBe(true);
  });
});

describe("F068.3 — the universe includes files that are not committed yet", () => {
  /** Like `repo`, but leaves `untracked` on disk WITHOUT `git add`ing it. That
   *  window — written, not yet staged — is the whole subject of this block, and
   *  it is the normal state of the file a pre-commit hook exists to judge. */
  function repoWithUntracked(
    committed: Record<string, string | Buffer>,
    untracked: Record<string, string | Buffer>,
  ): string {
    const cwd = repo(committed);
    for (const [name, content] of Object.entries(untracked)) {
      const dir = name.includes("/") ? join(cwd, name.slice(0, name.lastIndexOf("/"))) : cwd;
      if (dir !== cwd) mkdirSync(dir, { recursive: true });
      writeFileSync(join(cwd, name), content);
    }
    return cwd;
  }

  it("finds an UNTRACKED NUL file — the case that let beacon's own guard through", () => {
    // Their guard reported 313 files, all visible; the one file the commit was
    // about was the only one it never opened, because they ran it before staging.
    const content = Buffer.concat([Buffer.from("const k='"), NUL, Buffer.from("';\n")]);
    const cwd = repoWithUntracked({ "clean.ts": "export const a = 1;\n" }, { "new.ts": content });

    const r = checkGreppable({ cwd });
    expect(r.offenders.map((o) => o.file)).toEqual(["new.ts"]);
    expect(r.ok).toBe(false);
    // The counts must SHOW the widened universe, not merely benefit from it.
    expect(r.tracked).toBe(1);
    expect(r.untracked).toBe(1);
    expect(r.candidates).toBe(2);
  });

  it("finds an UNTRACKED latin-1 file too — the other half of the union", () => {
    // buddy's rule: when the universe changes, re-prove EVERY case, not only the
    // one that was reported. A fix aimed at the NUL axis could reach untracked
    // files for NUL alone and leave the decoder axis on the old list.
    const content = Buffer.concat([Buffer.from("bl"), OE, Buffer.from("d gr"), OE, Buffer.from("d\n")]);
    expect(content.includes(0)).toBe(false); // no NUL — only the decoder can catch it
    const cwd = repoWithUntracked({ "clean.ts": "export const a = 1;\n" }, { "nyt.txt": content });

    const r = checkGreppable({ cwd });
    expect(r.offenders.map((o) => o.file)).toEqual(["nyt.txt"]);
    expect(r.offenders[0]!.kind).toBe("utf8");
  });

  it("still does NOT scan ignored paths — the control 'scan everything' would fail", () => {
    // Widening the universe is trivially satisfiable by walking the whole disk,
    // and that version passes both tests above while making the tool unusable:
    // node_modules/ alone would bury every real finding. --exclude-standard is
    // what keeps the widening honest, so it is asserted on the COUNTS, not merely
    // on the run staying green.
    const nulBuf = Buffer.concat([Buffer.from("x"), NUL]);
    const cwd = repoWithUntracked(
      { ".gitignore": "node_modules/\ndist/\n", "clean.ts": "export const a = 1;\n" },
      { "node_modules/pkg/index.js": nulBuf, "dist/out.js": nulBuf },
    );

    const r = checkGreppable({ cwd });
    expect(r.offenders).toEqual([]);
    expect(r.untracked).toBe(0); // the ignored files are in NEITHER count
    expect(r.candidates).toBe(2); // .gitignore + clean.ts, nothing else
    expect(r.ok).toBe(true);
  });

  it("counts an untracked file as scanned, so coverage still adds up", () => {
    const cwd = repoWithUntracked(
      { "clean.ts": "export const a = 1;\n" },
      { "also-clean.ts": "export const b = 2;\n" },
    );
    const r = checkGreppable({ cwd });
    expect(r.scanned + r.skipped.length).toBe(r.candidates);
    expect(r.coverageGap).toBe(0);
    expect(r.ok).toBe(true);
  });
});
