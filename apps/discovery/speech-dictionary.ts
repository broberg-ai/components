// F044.1 — Discovery's read+edit surface over @broberg/speech-dictionary's data.
// Reads always reflect the latest COMMITTED state on GitHub (not a build-time
// snapshot like the rest of Discovery's inventory) because edits land via commits
// this module makes itself, with no Discovery redeploy in between. Ship-dark:
// edit 503s until GITHUB_WRITE_TOKEN + SPEECH_DICT_EDIT_KEY are both configured;
// reads work unauthenticated against the public repo either way.

const REPO = "broberg-ai/components";
const BRANCH = "main";
const TERMS_PATH = "packages/speech-dictionary/data/terms.json";
const CORRECTIONS_PATH = "packages/speech-dictionary/data/corrections.json";
const PKG_JSON_PATH = "packages/speech-dictionary/package.json";

export type TermGroup = "product" | "person" | "brand" | "tech";
export interface TermEntry {
  term: string;
  group: TermGroup;
}
export interface CorrectionEntry {
  wrong: string;
  right: string;
  note?: string | null;
  category?: string | null;
}
export type GroupKey = "products" | "people" | "brands" | "tech";
export type GroupedTerms = Record<GroupKey, string[]>;

const GROUP_TO_KEY: Record<TermGroup, GroupKey> = { product: "products", person: "people", brand: "brands", tech: "tech" };
const KEY_TO_GROUP: Record<GroupKey, TermGroup> = { products: "product", people: "person", brands: "brand", tech: "tech" };

export interface EditDiff {
  addTerms?: Partial<Record<GroupKey, string[]>>;
  removeTerms?: Partial<Record<GroupKey, string[]>>;
  addCorrections?: { wrong: string; right: string; note?: string }[];
  removeCorrections?: string[];
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_WRITE_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function getFile(path: string): Promise<{ content: string; sha: string }> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`github contents GET ${path} failed: ${res.status}`);
  const json = (await res.json()) as { content: string; sha: string };
  return { content: Buffer.from(json.content, "base64").toString("utf-8"), sha: json.sha };
}

async function putFile(path: string, content: string, sha: string, message: string): Promise<string> {
  const token = process.env.GITHUB_WRITE_TOKEN;
  if (!token) throw new Error("GITHUB_WRITE_TOKEN not configured");
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: { ...githubHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: Buffer.from(content, "utf-8").toString("base64"), sha, branch: BRANCH }),
  });
  if (!res.ok) throw new Error(`github contents PUT ${path} failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { commit: { sha: string } };
  return json.commit.sha;
}

async function createTag(tag: string, sha: string): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/git/refs`, {
    method: "POST",
    headers: { ...githubHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/tags/${tag}`, sha }),
  });
  if (!res.ok) throw new Error(`github create tag ${tag} failed: ${res.status} ${await res.text()}`);
}

export function groupTerms(entries: TermEntry[]): GroupedTerms {
  const g: GroupedTerms = { products: [], people: [], brands: [], tech: [] };
  for (const e of entries) g[GROUP_TO_KEY[e.group]].push(e.term);
  return g;
}

export function bumpPatch(version: string): string {
  const parts = version.split(".").map(Number);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join(".");
}

export interface DictionarySnapshot {
  version: string;
  tag: string;
  terms: GroupedTerms;
  corrections: { wrong: string; right: string; note?: string }[];
}

export async function readDictionary(): Promise<DictionarySnapshot> {
  const [termsFile, correctionsFile, pkgFile] = await Promise.all([
    getFile(TERMS_PATH),
    getFile(CORRECTIONS_PATH),
    getFile(PKG_JSON_PATH),
  ]);
  const terms: TermEntry[] = JSON.parse(termsFile.content);
  const corrections: CorrectionEntry[] = JSON.parse(correctionsFile.content);
  const version = (JSON.parse(pkgFile.content) as { version: string }).version;
  return {
    version,
    tag: `speech-dictionary-v${version}`,
    terms: groupTerms(terms),
    corrections: corrections.map((c) => ({ wrong: c.wrong, right: c.right, ...(c.note ? { note: c.note } : {}) })),
  };
}

export interface DiffResult {
  terms: TermEntry[];
  corrections: CorrectionEntry[];
  changed: boolean;
  added: { terms: GroupedTerms; corrections: { wrong: string; right: string; note?: string }[] };
  removed: { terms: GroupedTerms; corrections: string[] };
}

/** Pure — applies a diff against current state. Duplicate adds / missing removes are silent no-ops (idempotent, protects the "can't drift" invariant). */
export function applyDiff(currentTerms: TermEntry[], currentCorrections: CorrectionEntry[], diff: EditDiff): DiffResult {
  const terms = [...currentTerms];
  const corrections = [...currentCorrections];
  const added = { terms: { products: [], people: [], brands: [], tech: [] } as GroupedTerms, corrections: [] as { wrong: string; right: string; note?: string }[] };
  const removed = { terms: { products: [], people: [], brands: [], tech: [] } as GroupedTerms, corrections: [] as string[] };

  for (const key of Object.keys(diff.addTerms ?? {}) as GroupKey[]) {
    const group = KEY_TO_GROUP[key];
    for (const term of diff.addTerms?.[key] ?? []) {
      if (terms.some((t) => t.term === term && t.group === group)) continue;
      terms.push({ term, group });
      added.terms[key].push(term);
    }
  }
  for (const key of Object.keys(diff.removeTerms ?? {}) as GroupKey[]) {
    const group = KEY_TO_GROUP[key];
    for (const term of diff.removeTerms?.[key] ?? []) {
      const idx = terms.findIndex((t) => t.term === term && t.group === group);
      if (idx === -1) continue;
      terms.splice(idx, 1);
      removed.terms[key].push(term);
    }
  }
  for (const c of diff.addCorrections ?? []) {
    if (corrections.some((e) => e.wrong === c.wrong)) continue;
    corrections.push({ wrong: c.wrong, right: c.right, note: c.note ?? null, category: null });
    added.corrections.push({ wrong: c.wrong, right: c.right, ...(c.note ? { note: c.note } : {}) });
  }
  for (const wrong of diff.removeCorrections ?? []) {
    const idx = corrections.findIndex((e) => e.wrong === wrong);
    if (idx === -1) continue;
    corrections.splice(idx, 1);
    removed.corrections.push(wrong);
  }

  const changed =
    (Object.keys(added.terms) as GroupKey[]).some((k) => added.terms[k].length) ||
    (Object.keys(removed.terms) as GroupKey[]).some((k) => removed.terms[k].length) ||
    added.corrections.length > 0 ||
    removed.corrections.length > 0;

  return { terms, corrections, changed, added, removed };
}

export interface EditResult {
  ok: true;
  version: string;
  tag: string;
  commitSha: string | null;
  added: DiffResult["added"];
  removed: DiffResult["removed"];
}

export async function editDictionary(diff: EditDiff): Promise<EditResult> {
  const [termsFile, correctionsFile, pkgFile] = await Promise.all([
    getFile(TERMS_PATH),
    getFile(CORRECTIONS_PATH),
    getFile(PKG_JSON_PATH),
  ]);
  const currentTerms: TermEntry[] = JSON.parse(termsFile.content);
  const currentCorrections: CorrectionEntry[] = JSON.parse(correctionsFile.content);
  const pkg = JSON.parse(pkgFile.content) as { version: string; [k: string]: unknown };

  const result = applyDiff(currentTerms, currentCorrections, diff);
  if (!result.changed) {
    return { ok: true, version: pkg.version, tag: `speech-dictionary-v${pkg.version}`, commitSha: null, added: result.added, removed: result.removed };
  }

  const nextVersion = bumpPatch(pkg.version);
  let lastSha = termsFile.sha;
  const termsChanged = JSON.stringify(currentTerms) !== JSON.stringify(result.terms);
  const correctionsChanged = JSON.stringify(currentCorrections) !== JSON.stringify(result.corrections);

  if (termsChanged) {
    lastSha = await putFile(TERMS_PATH, JSON.stringify(result.terms, null, 2) + "\n", termsFile.sha, `chore(speech-dictionary): edit terms → v${nextVersion}`);
  }
  if (correctionsChanged) {
    lastSha = await putFile(
      CORRECTIONS_PATH,
      JSON.stringify(result.corrections, null, 2) + "\n",
      correctionsFile.sha,
      `chore(speech-dictionary): edit corrections → v${nextVersion}`,
    );
  }
  const nextPkg = { ...pkg, version: nextVersion };
  lastSha = await putFile(PKG_JSON_PATH, JSON.stringify(nextPkg, null, 2) + "\n", pkgFile.sha, `chore(speech-dictionary): v${nextVersion}`);

  const tag = `speech-dictionary-v${nextVersion}`;
  await createTag(tag, lastSha);

  return { ok: true, version: nextVersion, tag, commitSha: lastSha, added: result.added, removed: result.removed };
}
