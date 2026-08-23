// F076.12 — sending to many people at once.
//
// Until now, 5,000 messages were 5,000 HTTP calls. Every gateway offers a batch
// and we used none of them. That is the cost that starts to hurt at exactly the
// moment the volume is worth invoicing for.
//
// THE HARD PART IS NOT THE HTTP CALL. It is that everything this package has
// built is PER RECIPIENT — the price, the consent gate, the duplicate lock, the
// four outcomes, the six skip reasons — and all of it has to keep being per
// recipient once the transport stops being. So:
//
//   sendMany() RETURNS ONE RESULT PER RECIPIENT, in the order given, always.
//
// A batch that reports a single status hides the forty recipients out of five
// thousand that were blocked, and hides them behind a green result.
//
// AND ONE FAILURE MUST NOT ABORT THE REST. A bad number at position 300 of 5,000
// is the ordinary case, not the exceptional one. The naive implementation stops
// there, and the failure it produces is a campaign that half-sent with no record
// of where it stopped.

/**
 * One settled outcome for one message inside a batch.
 *
 * The `error` is classified by the SAME BRAND the single-send path uses: a
 * branded SmsUnknownError becomes `unknown`, anything else becomes `refused`.
 * One rule, both paths — so the batch cannot invent a fifth outcome, and a
 * recipient whose answer never arrived is never handed to a retry.
 */
export type BatchOutcome = { ok: true; id?: string } | { ok: false; error: Error };

/** How a client will actually send a batch. Read it at boot — see SmsClient.batch. */
export interface BatchPlan {
  /**
   * 'gateway-batch' — the provider has a real multi-recipient endpoint, so N
   * recipients cost ceil(N / size) HTTP calls.
   * 'fan-out'       — it does not, so N recipients cost N calls, `concurrency`
   *                   of them in flight at a time.
   *
   * The difference between 5 requests and 5,000 is worth being able to read
   * rather than infer.
   */
  mode: 'gateway-batch' | 'fan-out';
  /** Recipients per HTTP call. 1 on the fan-out path, by definition. */
  size: number;
  /** How many requests are in flight at once. */
  concurrency: number;
}

export interface SendManyOptions {
  /**
   * Requests in flight at once. Default 5.
   *
   * Deliberately modest. This is the knob that turns a large send into a 429,
   * and a 429 is a refusal the caller then has to deal with per recipient.
   */
  concurrency?: number;
  /**
   * Recipients per HTTP call, overriding the provider's own limit.
   *
   * Only ever lowers it in practice: raising it past what the gateway accepts
   * turns a working batch into a 422 for everyone in it.
   */
  chunkSize?: number;
}

export const DEFAULT_CONCURRENCY = 5;

/** Split into groups of at most `size`. A size below 1 would loop forever. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

/**
 * Run `work` over every item with at most `limit` in flight, RESULTS IN INPUT
 * ORDER regardless of which finished first.
 *
 * `work` must not reject: this pool has no failure path on purpose. Every caller
 * here already turns a throw into a per-item outcome, and a pool that could
 * reject would abort the remaining recipients — the exact behaviour this card
 * exists to prevent.
 */
export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(Math.floor(limit), items.length));

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await work(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return out;
}
