/**
 * Test setup — give the jsdom environment a complete in-memory localStorage.
 * vitest's jsdom Storage is incomplete (no .clear), so tests get a deterministic
 * one. Guarded on `window` so the node-env SSR test stays pure (no localStorage).
 */
if (typeof window !== "undefined") {
  const store = new Map<string, string>();
  const ls = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
  } as Storage;
  Object.defineProperty(window, "localStorage", { configurable: true, writable: true, value: ls });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: ls });
}
