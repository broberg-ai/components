// F005.14 — correct DNS records are not permission to send (helpdesk #26860).
import { describe, it, expect } from 'vitest';
import { checkResendDomain, checkSendingPermission, maySendFromStatus, RESEND_DOMAIN_STATUSES, type DnsResolver } from '../src/verify';

const KEY = 're_test';
const domains = (data: unknown[], status = 200) =>
  (async () => new Response(JSON.stringify({ object: 'list', data }), { status })) as unknown as typeof fetch;
const resendWith = (status: string) => domains([{ id: 'd1', name: 'other.example', status: 'verified' }, { id: 'd2', name: 'send.done.example', status }]);

const allOkDns: DnsResolver = {
  async resolveTxt(name) {
    const m: Record<string, string[][]> = {
      'send.done.example': [['v=spf1 include:amazonses.com ~all']],
      'resend._domainkey.send.done.example': [['p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC2N']],
      '_dmarc.send.done.example': [['v=DMARC1; p=none;']],
    };
    if (m[name]) return m[name]!;
    throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  },
  async resolveMx() { return [{ exchange: 'feedback-smtp.eu-west-1.amazonses.com', priority: 10 }]; },
};

describe('F005.14 — Resend decides whether a domain may send', () => {
  it('verified is the ONLY yes; the known non-verified statuses are no', async () => {
    const out: Record<string, string> = {};
    for (const s of RESEND_DOMAIN_STATUSES) {
      const r = await checkResendDomain('Support <hej@send.done.example>', { apiKey: KEY, fetch: resendWith(s) });
      out[s] = r.maySend;
    }
    expect(out).toEqual({ not_started: 'no', pending: 'no', verified: 'yes', failure: 'no', temporary_failure: 'no' });
  });

  it('a status we invent (not in today\'s vocabulary) is kept verbatim and is NOT permission', async () => {
    const r = await checkResendDomain('send.done.example', { apiKey: KEY, fetch: resendWith('partially_verified_2027') });
    expect(r).toEqual({ ok: true, domain: 'send.done.example', registered: true, status: 'partially_verified_2027', knownStatus: false, maySend: 'unknown' });
    expect(maySendFromStatus('anything_new')).toBe('unknown');
  });

  it('could-not-ask is ok:false — never a Resend status, and never not_started (no key, 401, 500, network, bad input)', async () => {
    const cases = [
      await checkResendDomain('send.done.example', {}),
      await checkResendDomain('send.done.example', { apiKey: KEY, fetch: domains([], 401) }),
      await checkResendDomain('send.done.example', { apiKey: KEY, fetch: domains([], 500) }),
      await checkResendDomain('send.done.example', { apiKey: KEY, fetch: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch }),
      await checkResendDomain('not a domain', { apiKey: KEY, fetch: resendWith('verified') }),
    ];
    for (const r of cases) {
      expect(r).toMatchObject({ ok: false, reason: 'could_not_ask', maySend: 'unknown' });
      expect('status' in r).toBe(false);
    }
  });

  it('a domain Resend does not have is registered:false and may not send', async () => {
    expect(await checkResendDomain('send.unknown.example', { apiKey: KEY, fetch: resendWith('verified') })).toEqual({ ok: true, domain: 'send.unknown.example', registered: false, maySend: 'no' });
  });

  it('DNS all ok + Resend pending stays visible as both — and the answer is no', async () => {
    const p = await checkSendingPermission('send.done.example', { resolver: allOkDns, apiKey: KEY, fetch: resendWith('pending') });
    expect(p.dns.ok).toBe(true);
    expect(p.resend).toMatchObject({ ok: true, status: 'pending', maySend: 'no' });
    expect(p.maySend).toBe('no');
  });

  it('ships dark: no key → a defined answer (unknown), never a throw, and the DNS half still reports', async () => {
    const p = await checkSendingPermission('send.done.example', { resolver: allOkDns });
    expect(p.maySend).toBe('unknown');
    expect(p.resend).toMatchObject({ ok: false, reason: 'could_not_ask' });
    expect(p.dns.ok).toBe(true);
  });
});
