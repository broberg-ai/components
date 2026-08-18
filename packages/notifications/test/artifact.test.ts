// F074.1 — assert against the SHIPPED bundle, not against the source.
//
// The source can be right while the artifact is wrong: three exported types were
// missing from a sibling package's built .d.ts while every source file declared
// them, and the first check written to catch it was itself pointed at the wrong
// symbol. So this reads dist/.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

/** No skip. A skip here is the silent green this package exists to abolish. */
function dist(file: string): string {
  const path = at(`dist/${file}`);
  if (!existsSync(path)) throw new Error(`${file} is missing — run \`npm run build\` before the suite`);
  return readFileSync(path, 'utf8');
}

describe('F074.1 — the package does not depend on @broberg/webpush', () => {
  // It calls sendSilent/syncBadge only THROUGH onCountChanged. A direct
  // dependency would be wrong for cardmem (who fan out to SSE as well) and would
  // drag VAPID into a package that has no business knowing about it.
  it.each(['index.js', 'index.cjs'])('%s contains no reference to it', (file) => {
    expect(dist(file)).not.toContain('@broberg/webpush');
  });

  it('declares no runtime dependencies at all', () => {
    const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8'));
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});

describe('F074.1 — the public surface is present in the shipped types', () => {
  it.each(['createNotifications', 'createMemoryStore', 'NotificationRow', 'NotificationStore', 'ClearResult', 'NotificationsConfig', 'Notifications'])(
    '%s is declared in dist/index.d.ts',
    (symbol) => {
      expect(dist('index.d.ts')).toContain(symbol);
    },
  );
});
