// F067.2 — find a second push handler in a BUILT worker, without a browser.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { findPushHandlers } from '../src/push-handlers';

describe('findPushHandlers — over a source string (F067.2)', () => {
  it('two registrations are found, each with WHERE (line, column, offset)', () => {
    const src = [
      "importScripts('/sw.global.js');",
      "self.addEventListener('push', (e) => template(e));",
      "self.addEventListener(\"push\", (e) => other(e));",
    ].join('\n');
    const r = findPushHandlers(src);
    expect(r.count).toBe(2);
    expect(r.sites.map(({ line, column }) => ({ line, column }))).toStrictEqual([
      { line: 2, column: 6 },
      { line: 3, column: 6 },
    ]);
    expect(r.sites[0]!.snippet).toContain("addEventListener('push'");
  });

  it('every quote style and an onpush assignment count; onpush comparisons and other events do not', () => {
    const src = 'a.addEventListener(`push`,f);b.addEventListener( "push" ,g);self.onpush = h;if(self.onpush==null){};self.addEventListener("pushsubscriptionchange",k);self.addEventListener("notificationclick",n);';
    expect(findPushHandlers(src).count).toBe(3);
  });

  it('a minified one-line bundle reports its OFFSET (line 1 is no help there)', () => {
    const src = 'x();'.repeat(100) + 'self.addEventListener("push",a);' + 'y();'.repeat(50) + 'self.addEventListener("push",b);';
    const r = findPushHandlers(src);
    expect(r.count).toBe(2);
    const first = src.indexOf('addEventListener("push"');
    const second = src.indexOf('addEventListener("push"', first + 1);
    expect(r.sites.map((s) => s.offset)).toStrictEqual([first, second]);
    expect(r.sites.every((s) => s.line === 1)).toBe(true);
  });

  it('a worker with no push handler reports zero', () => {
    expect(findPushHandlers('self.addEventListener("fetch",f)')).toStrictEqual({ count: 0, sites: [] });
  });
});

describe('the REAL built sw.global.js registers exactly one — no false positive on our own file', () => {
  const built = new URL('../dist/sw.global.js', import.meta.url);
  it.runIf(existsSync(built))('dist/sw.global.js → count 1', () => {
    expect(findPushHandlers(readFileSync(built, 'utf8')).count).toBe(1);
  });
  it.runIf(existsSync(built))('...and adopting it next to a template handler is caught → 2', () => {
    const consumer = readFileSync(built, 'utf8') + '\nself.addEventListener("push", (e) => e.waitUntil(self.registration.showNotification("template")));';
    expect(findPushHandlers(consumer).count).toBe(2);
  });
});
