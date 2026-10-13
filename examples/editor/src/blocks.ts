// One block list for the page AND the server, so what the editor writes the server can render.
import { defineBlock, escapeHTML } from "@broberg/editor/server";

export const product = defineBlock({
  name: "product",
  attrs: ["sku"],
  required: ["sku"],
  label: "Vare",
  renderHTML: (a) => `<a class="product" href="/varer/${encodeURIComponent(a.sku!)}">Vare ${escapeHTML(a.sku!)}</a>`,
});
export const blocks = [product];
