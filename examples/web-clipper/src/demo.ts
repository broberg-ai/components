// An INVENTED destination for the example: it keeps clips in this extension's
// own chrome.storage, so the example works with no backend. Two targets so the
// picker has something to pick between.
import type { Destination } from "@broberg/web-clipper/transport";
import type { KeyValueStorage } from "@broberg/web-clipper/auth";

export function demoDestination(storage: KeyValueStorage): Destination {
  return {
    id: "demo",
    label: "Demo",
    targets: async () => [
      { id: "notes", label: "Noter", group: "Demo" },
      { id: "research", label: "Forskning", group: "Demo" },
    ],
    async send(units, { target, clip }) {
      const key = `demo:${target.id}`;
      const kept = ((await storage.get(key)) as unknown[] | undefined) ?? [];
      await storage.set(key, [...kept, { url: clip.url, title: clip.title, units: units.length, at: Date.now() }]);
    },
  };
}
