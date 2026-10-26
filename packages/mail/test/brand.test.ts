// F005.26 — BIMI readiness: what stands between a sender and a logo in the inbox.
// Report only; it never blocks a send.
import { describe, it, expect } from 'vitest';
import { checkBrandReadiness, parseTags, bimiHosts } from '../src/verify';

const nx = Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
const servfail = Object.assign(new Error('sf'), { code: 'ESERVFAIL' });
function resolver(txt: Record<string, string[][] | Error>) {
  return { async resolveTxt(h: string) { const v = txt[h]; if (v instanceof Error) throw v; if (!v) throw nx; return v; } };
}
const READY = {
  '_dmarc.x.dk': [['v=DMARC1; p=reject; pct=100; rua=mailto:d@x.dk; adkim=s; aspf=s']],
  'default._bimi.x.dk': [['v=BIMI1; l=https://x.dk/logo.svg; a=https://x.dk/vmc.pem']],
};

describe('F005.26 — checkBrandReadiness', () => {
  it('a fully ready domain has no warnings and reports the parsed policy', async () => {
    const r = await checkBrandReadiness('X <hi@x.dk>', { resolver: resolver(READY) });
    expect(r.warnings).toEqual([]);
    expect(r.dmarc).toEqual({ host: '_dmarc.x.dk', p: 'reject', sp: undefined, pct: 100, rua: 'mailto:d@x.dk', adkim: 's', aspf: 's' });
    expect(r.bimi).toEqual({ host: 'default._bimi.x.dk', l: 'https://x.dk/logo.svg', a: 'https://x.dk/vmc.pem' });
  });

  it('no DMARC → named, with the first-step record; no BIMI → named', async () => {
    const r = await checkBrandReadiness('x.dk', { resolver: resolver({}) });
    expect(r.dmarc).toBeNull();
    expect(r.bimi).toBeNull();
    expect(r.warnings[0]).toContain('No DMARC policy for x.dk');
    expect(r.warnings[0]).toContain('p=none; rua=');
    expect(r.warnings.some((w) => w.includes('No BIMI record (default._bimi.x.dk)'))).toBe(true);
  });

  it('p=none and a missing rua are each named', async () => {
    const r = await checkBrandReadiness('x.dk', { resolver: resolver({ ...READY, '_dmarc.x.dk': [['v=DMARC1; p=none']] }) });
    expect(r.warnings.some((w) => w.includes('p=none') && w.includes('quarantine or p=reject'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('no rua='))).toBe(true);
  });

  it('enforced but pct<100 and relaxed alignment are each named', async () => {
    const r = await checkBrandReadiness('x.dk', { resolver: resolver({ ...READY, '_dmarc.x.dk': [['v=DMARC1; p=quarantine; pct=50; rua=mailto:d@x.dk']] }) });
    expect(r.warnings.some((w) => w.includes('pct=50'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('relaxed alignment (adkim=r, aspf=r)'))).toBe(true);
  });

  it('BIMI without a certificate is named (Gmail/Apple will not show it); http logo is named', async () => {
    const r = await checkBrandReadiness('x.dk', { resolver: resolver({ ...READY, 'default._bimi.x.dk': [['v=BIMI1; l=http://x.dk/logo.svg; a=']] }) });
    expect(r.warnings.some((w) => w.includes('no certificate (a=)'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('must be served over https'))).toBe(true);
  });

  it('a subdomain falls back to the organisational domain for both records', async () => {
    const r = await checkBrandReadiness('noreply@send.x.dk', { resolver: resolver(READY) });
    expect(r.warnings).toEqual([]);
    expect((r.dmarc as { host: string }).host).toBe('_dmarc.x.dk');
    expect(bimiHosts('send.x.dk')).toEqual(['default._bimi.send.x.dk', 'default._bimi.x.dk']);
  });

  it('a DNS failure is "unknown", never "missing" — and never throws', async () => {
    const r = await checkBrandReadiness('x.dk', { resolver: resolver({ '_dmarc.x.dk': servfail, 'default._bimi.x.dk': servfail }) });
    expect(r.dmarc).toBe('unknown');
    expect(r.bimi).toBe('unknown');
    expect(r.warnings.every((w) => w.includes('not checked'))).toBe(true);
  });

  it('parseTags reads a policy, case-insensitive tag names', () => {
    expect(parseTags('v=DMARC1; P=reject;rua=mailto:a@b ')).toEqual({ v: 'DMARC1', p: 'reject', rua: 'mailto:a@b' });
  });
});

describe('F005.26 — sending is untouched', () => {
  it('the send path does not call the BIMI check (a logo warning never blocks a mail)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('checkBrandReadiness');
  });
});
