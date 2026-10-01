// F089.3 — both stacks count from the browser, and nothing else gets through.
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeatureStats, createMemoryFeatureStore, defineFeatures } from '../src/index.js';
import { featureStatsRoute } from '../src/hono.js';
import { featureStatsHandler } from '../src/next.js';
import { trackFeature } from '../src/client.js';

const FEATURES = defineFeatures(['export.pdf'] as const);
const fresh = () => createFeatureStats({ features: FEATURES, store: createMemoryFeatureStore(), now: () => new Date('2026-10-01T12:00:00Z') });
const ONE = [{ feature: 'export.pdf', day: '2026-10-01', count: 1 }];
const BODIES: Array<[string, string, number]> = [
  ['declared key', '{"feature":"export.pdf"}', 204],
  ['undeclared key', '{"feature":"open-doc-4711"}', 400],
  ['malformed JSON', '{feature:', 400],
  ['JSON null', 'null', 400],
  ['oversized body', JSON.stringify({ feature: 'export.pdf', pad: 'x'.repeat(2000) }), 400],
];

describe('/hono', () => {
  it.each(BODIES)('%s', async (_n, body, status) => {
    const stats = fresh();
    const app = new Hono().post('/fs', featureStatsRoute(stats));
    const res = await app.request('/fs', { method: 'POST', body });
    expect(res.status).toBe(status);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await stats.read()).toEqual(status === 204 ? ONE : []);
  });
});

describe('/next', () => {
  it.each(BODIES)('%s', async (_n, body, status) => {
    const stats = fresh();
    const res = await featureStatsHandler(stats)(new Request('http://x/api/fs', { method: 'POST', body }));
    expect(res.status).toBe(status);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await stats.read()).toEqual(status === 204 ? ONE : []);
  });
});

describe('/client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses sendBeacon with exactly {feature}', async () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    trackFeature('export.pdf', { endpoint: '/fs' });
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe('/fs');
    expect(await blob.text()).toBe('{"feature":"export.pdf"}');
    expect(f).not.toHaveBeenCalled();
  });

  it('falls back to fetch keepalive when there is no sendBeacon', () => {
    vi.stubGlobal('navigator', {});
    const f = vi.fn(() => Promise.resolve(new Response(null)));
    vi.stubGlobal('fetch', f);
    trackFeature('export.pdf', { endpoint: '/fs' });
    expect(f).toHaveBeenCalledWith('/fs', {
      method: 'POST',
      body: '{"feature":"export.pdf"}',
      keepalive: true,
      headers: { 'content-type': 'text/plain' },
    });
  });

  it('with neither, it is a no-op; when both throw, it still does not throw', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('fetch', undefined);
    expect(() => trackFeature('export.pdf', { endpoint: '/fs' })).not.toThrow();
    const errors: unknown[] = [];
    vi.stubGlobal('navigator', { sendBeacon: () => { throw new Error('boom'); } });
    expect(() => trackFeature('export.pdf', { endpoint: '/fs', onError: (e) => errors.push(e) })).not.toThrow();
    expect(errors.length).toBe(1);
  });

  it('touches no cookie or storage — asserted on the source itself', () => {
    const src = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB/);
  });
});
