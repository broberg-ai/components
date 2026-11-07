# @broberg/provider-usage

What each database, machine and bucket actually costs at the provider, in one shape for every provider.

> **0.1.0 = UpCloud only, and NOT live-verified yet.** It is built against the response shapes in UpCloud's own documentation. The first call with a key that may read billing is still to come. Scaleway, Cloudflare R2, Supabase and Fly follow (F113.2–F113.4).

## Use

```ts
import { createUpcloudUsage } from "@broberg/provider-usage";

const upcloud = createUpcloudUsage({ token: process.env.UPCLOUD_BILLING_TOKEN });
const r = await upcloud.month("2026-11");               // { daily: true } adds per-day sums
if (r.ok) {
  for (const line of r.lines) console.log(line.resourceType, line.resourceId, line.amount, line.currency, line.basis);
} else {
  console.warn(r.reason, r.message);                      // not_configured · no_billing_access · unavailable · invalid_response
}
```

Each `UsageLine` has the fields `provider`, `resourceId`, `resourceType` (UpCloud's own: `managed_database`, `server`, `managed_object_storage` …), `period` (`from` inclusive, `to` exclusive), `amount`, `currency`, `basis`, `complete`, `details` and `fetchedAt`:

- `basis`: `"billed"` (what the provider invoices) or `"estimated"` (list price × usage). It is never missing.
- `complete`: `false` while the month is still running, because the amount will grow.
- `details.segments`: one entry per plan or zone the resource ran on. A mid-month resize gives two segments, and then no single `plan` is claimed for the month.

## What it promises

- **Cost price only.** A margin (e.g. +30 %) and the customer's price belong to you, in one place.
- **A key without billing rights is not "costs nothing".** UpCloud 403/404 answers `no_billing_access`, never an empty list.
- **No key, no call.** Without `token` it answers `not_configured` and does nothing.
- **Only the billing paths, only GET, enforced in the code.** UpCloud tokens have no scopes, and `GET /1.3/database` returns production database passwords in clear text. This module can only reach `GET /1.3/account/billing/summary/{YYYY-MM}` and `GET /1.3/account/resource_billing_summary/{id}/{YYYY-MM}`. Anything else throws before a request leaves.
- The token never appears in a failure.

## The key (the owner creates it)

UpCloud: a sub-account with only **«read billing details»**. A main-account token is fully writable. Put it in the cardmem vault and read it from env.

## What it does NOT do

- No storage. It fetches, and you keep the result.
- No invoices (UpCloud has no invoice endpoint) and no PDF reading.
- No other provider yet.
