// An in-memory Mollie v2 API: customers, payments (first/recurring), routes, refunds.
import { MOLLIE_API } from "../src/client";

export function fakeMollie() {
  const payments = new Map<string, any>();
  const routes = new Map<string, any[]>();
  const refunds: any[] = [];
  const requests: Array<{ method: string; path: string; body: any; auth: string | null }> = [];
  let n = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/hal+json" } });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!url.href.startsWith(MOLLIE_API)) throw new Error("fake-mollie: wrong host " + url.href);
    const path = url.pathname.replace("/v2", "");
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const auth = new Headers(init?.headers).get("authorization");
    requests.push({ method: init?.method ?? "GET", path, body, auth });
    if (auth !== "Bearer test_abc") return json(401, { title: "Unauthorized Request" });
    let m;
    if (init?.method === "POST" && path === "/customers") return json(201, { id: `cst_${++n}`, ...body });
    if (init?.method === "POST" && path === "/payments") {
      const p = { id: `tr_${++n}`, status: "open", ...body, _links: body.sequenceType === "first" ? { checkout: { href: `https://pay.mollie.test/${n}` } } : {} };
      payments.set(p.id, p); return json(201, p);
    }
    if ((m = path.match(/^\/payments\/([^/]+)$/))) { const p = payments.get(m[1]!); return p ? json(200, p) : json(404, { title: "Not Found" }); }
    if ((m = path.match(/^\/payments\/([^/]+)\/routes$/))) {
      const list = routes.get(m[1]!) ?? [];
      if (init?.method === "POST") { const r = { id: `rt_${++n}`, ...body }; list.push(r); routes.set(m[1]!, list); return json(201, r); }
      return json(200, { count: list.length, _embedded: { routes: list } });
    }
    if ((m = path.match(/^\/payments\/([^/]+)\/refunds$/)) && init?.method === "POST") { const r = { id: `re_${++n}`, status: "queued", paymentId: m[1], ...body }; refunds.push(r); return json(201, r); }
    return json(404, { title: "Not Found" });
  }) as typeof fetch;
  return { fetch: fetchImpl, payments, routes, refunds, requests, markPaid: (id: string) => { payments.get(id).status = "paid"; } };
}
