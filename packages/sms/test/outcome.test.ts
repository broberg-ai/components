// F076.6 — a send has FOUR outcomes, and `ok: boolean` carries two.
//
// The load-bearing assertion here is NOT any single case. It is that all THREE
// adapters classify the same situation the same way — one table, not three
// copies of the same test. That shape catches the bug that actually happened
// while this card was being written: two adapters got the branded error and the
// third did not, because its import line differed by one word. Three separate
// green tests would have been three separate opportunities to forget.
//
// The rule under all of it, and it fits on a line:
//   `refused` means the gateway TOLD us no. Anything else that is not a
//   confirmed send is `unknown`.
//
// Note that two of the three refusals below arrive on a 2xx — so the classifier
// cannot be `res.ok ? unknown : refused`, and a test that only used HTTP status
// would pass over an implementation that was wrong for sms.dk and inMobile.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createSms,
  gatewayapi,
  smsdk,
  inmobile,
  SmsUnknownError,
  isUnknownSendError,
  type SmsOutcome,
  type SmsProvider,
  type SmsResult,
} from '../src/index';

const OUTCOMES: SmsOutcome[] = ['sent', 'skipped', 'refused', 'unknown'];

/** Assert the outcome IS one value and is NOT any of the other three. */
function expectOutcome(res: SmsResult, want: SmsOutcome) {
  expect(res.outcome).toBe(want);
  for (const other of OUTCOMES) {
    if (other !== want) expect(res.outcome).not.toBe(other);
  }
}

function stubStatus(status: number, body: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));
}
function stubThrow(err: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw err;
    }),
  );
}
const timeoutError = () => {
  const e = new Error('The operation was aborted due to timeout');
  e.name = 'TimeoutError';
  return e;
};

afterEach(() => vi.unstubAllGlobals());

type Case = [status: number, body: string];

interface Gateway {
  name: string;
  provider: () => SmsProvider;
  from: string;
  /** A confirmed send. */
  sent: Case;
  /** They TOLD us no. Note: only GatewayAPI does this with a non-2xx. */
  refused: Case;
  /** They accepted it and the body cannot be read. */
  acceptedUnreadable: Case;
  /** They accepted it and told us nothing we can act on. */
  acceptedButSilent: Case;
}

const GATEWAYS: Gateway[] = [
  {
    name: 'gatewayapi',
    provider: () => gatewayapi({ apiKey: 'k' }),
    from: 'Moovyy',
    sent: [202, JSON.stringify({ msg_id: '01JNN696A9E0WS89FPYGT15NBX', recipient: 4522680880 })],
    refused: [403, JSON.stringify({ code: 'forbidden', message: 'Invalid token' })],
    acceptedUnreadable: [202, '<html><body>accepted</body></html>'],
    acceptedButSilent: [202, JSON.stringify({ recipient: 4522680880, reference: null })],
  },
  {
    name: 'smsdk',
    provider: () => smsdk({ apiKey: 'k' }),
    from: 'SMSDKDemo',
    sent: [
      200,
      JSON.stringify({
        status: 'success',
        messageCode: 5000,
        result: { batchId: 'b1', report: { accepted: [{ receiver: 4522680880, creditCost: 1 }], rejected: [] } },
      }),
    ],
    // A 207. res.ok is TRUE and this recipient still went nowhere.
    refused: [
      207,
      JSON.stringify({
        status: 'mixed',
        messageCode: 3000,
        result: {
          batchId: 'b1',
          report: {
            accepted: [],
            rejected: [{ receiver: 4522680880, messageCode: 1015, message: 'Country code and phone number do not match.' }],
          },
        },
      }),
    ],
    acceptedUnreadable: [200, '<!doctype html><html><body>hello</body></html>'],
    acceptedButSilent: [
      200,
      JSON.stringify({ status: 'success', messageCode: 5000, result: { report: { accepted: [], rejected: [] } } }),
    ],
  },
  {
    name: 'inmobile',
    provider: () => inmobile({ apiKey: 'k' }),
    from: 'Broberg',
    sent: [
      200,
      JSON.stringify({
        results: [
          {
            messageId: '8fe266b2-56e9-4b5f-938f-cc5e22530721',
            smsCount: 1,
            numberDetails: { msisdn: '4522680880', rawMsisdn: '4522680880', isValidMsisdn: true },
          },
        ],
      }),
    ],
    // A 200 with a real messageId. The refusal is two levels down.
    refused: [
      200,
      JSON.stringify({
        results: [
          {
            messageId: '8fe266b2-56e9-4b5f-938f-cc5e22530721',
            smsCount: 1,
            numberDetails: { msisdn: '4522680880', rawMsisdn: '4522680880', isValidMsisdn: false },
          },
        ],
      }),
    ],
    acceptedUnreadable: [200, '<!doctype html><html><body>hello</body></html>'],
    acceptedButSilent: [200, JSON.stringify({ results: [] })],
  },
];

const send = (g: Gateway) =>
  createSms({ provider: g.provider(), from: g.from, live: true }).send({ to: '+4522680880', text: 'Hej' });

describe('EVERY GATEWAY AGREES — the invariant, not three separate cases', () => {
  // Each block asserts the per-gateway value AND that the three agree. The
  // agreement is the half that catches a forgotten adapter.
  const situations = [
    ['a confirmed send', (g: Gateway) => stubStatus(...g.sent), 'sent'],
    ['the gateway TOLD us no', (g: Gateway) => stubStatus(...g.refused), 'refused'],
    ['no answer within the timeout', () => stubThrow(timeoutError()), 'unknown'],
    ['the socket died', () => stubThrow(new TypeError('fetch failed')), 'unknown'],
    ['accepted, body unreadable', (g: Gateway) => stubStatus(...g.acceptedUnreadable), 'unknown'],
    ['accepted, nothing we can act on', (g: Gateway) => stubStatus(...g.acceptedButSilent), 'unknown'],
  ] as const;

  for (const [label, arrange, want] of situations) {
    it(`${label} → ${want}, on all three`, async () => {
      const seen: SmsOutcome[] = [];
      for (const g of GATEWAYS) {
        arrange(g);
        const res = await send(g);
        expectOutcome(res, want);
        seen.push(res.outcome);
        vi.unstubAllGlobals();
      }
      // The discriminating half: three gateways, ONE answer.
      expect(new Set(seen).size).toBe(1);
      expect(seen).toHaveLength(GATEWAYS.length);
    });
  }
});

describe('a timeout and a refusal are different VALUES, not different sentences', () => {
  it.each(GATEWAYS.map((g) => [g.name, g] as const))('%s', async (_name, g) => {
    stubThrow(timeoutError());
    const timedOut = await send(g);
    vi.unstubAllGlobals();

    stubStatus(...g.refused);
    const refused = await send(g);

    // Both are ok:false — which is exactly why `ok` cannot be the discriminator.
    expect(timedOut.ok).toBe(false);
    expect(refused.ok).toBe(false);
    expect(timedOut.outcome).not.toBe(refused.outcome);
    expect(timedOut.outcome).toBe('unknown');
    expect(refused.outcome).toBe('refused');
  });
});

describe('the decision is on the KIND, never on the words', () => {
  // AC#1. If the classifier read the message text, this test would go green on
  // an implementation that is wrong — so it is written to be able to fail.
  const fake = (thrown: unknown): SmsProvider => ({
    name: 'fake',
    async send() {
      throw thrown;
    },
  });
  const run = (thrown: unknown) =>
    createSms({ provider: fake(thrown), from: 'X', live: true }).send({ to: '+4522680880', text: 'Hej' });

  it('an ORDINARY Error whose text screams "MAY OR MAY NOT HAVE BEEN SENT" is still a refusal', async () => {
    const res = await run(
      new Error('fake: no response within 15000ms. THE MESSAGE MAY OR MAY NOT HAVE BEEN SENT. Do NOT retry blindly.'),
    );
    expectOutcome(res, 'refused');
  });

  it('a BRANDED error with a bland, reassuring message is still unknown', async () => {
    const res = await run(new SmsUnknownError('fake: fine'));
    expectOutcome(res, 'unknown');
  });
});

describe('the brand, not instanceof — because instanceof breaks on a duplicated copy', () => {
  it('a foreign copy of the class still reads as unknown', () => {
    // Exactly what a second copy of @broberg/sms in one bundle produces: same
    // shape, different class identity. instanceof says no; the brand says yes.
    class ForeignCopy extends Error {
      readonly smsOutcome = 'unknown' as const;
    }
    const err = new ForeignCopy('from another copy of this package');
    expect(err instanceof SmsUnknownError).toBe(false);
    expect(isUnknownSendError(err)).toBe(true);
  });

  it('our own class reads as unknown', () => {
    expect(isUnknownSendError(new SmsUnknownError('x'))).toBe(true);
  });

  it.each([
    ['a plain Error', new Error('nope')],
    ['a string', 'nope'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object branded refused', { smsOutcome: 'refused' }],
    ['an object with no brand', { message: 'nope' }],
  ])('%s does NOT read as unknown', (_label, value) => {
    expect(isUnknownSendError(value)).toBe(false);
  });
});

describe('existing consumers do not silently change behaviour', () => {
  it('AC#5 — an `if (!res.ok)` alarm still fires on an unknown', async () => {
    stubThrow(timeoutError());
    const res = await send(GATEWAYS[0]);
    let alarmed = false;
    if (!res.ok) alarmed = true;
    expect(alarmed).toBe(true);
    expect(res.outcome).toBe('unknown');
  });

  it('a dark-mode skip is still ok:true, and keeps its `skipped` flag', async () => {
    const res = await createSms({ provider: gatewayapi({ apiKey: 'k' }), from: 'Moovyy' }).send({
      to: '+4522680880',
      text: 'Hej',
    });
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(true);
    expectOutcome(res, 'skipped');
  });

  it('a locally refused number never reaches the gateway', async () => {
    const calls = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', calls);
    const res = await createSms({ provider: gatewayapi({ apiKey: 'k' }), from: 'Moovyy', live: true }).send({
      to: '123',
      text: 'Hej',
    });
    expect(calls).not.toHaveBeenCalled();
    expectOutcome(res, 'refused');
  });
});

describe('all four outcomes are reachable — no dead branch in the type', () => {
  it('the union is exhausted by real sends', async () => {
    const seen = new Set<SmsOutcome>();

    stubStatus(...GATEWAYS[0].sent);
    seen.add((await send(GATEWAYS[0])).outcome);
    vi.unstubAllGlobals();

    stubStatus(...GATEWAYS[0].refused);
    seen.add((await send(GATEWAYS[0])).outcome);
    vi.unstubAllGlobals();

    stubThrow(timeoutError());
    seen.add((await send(GATEWAYS[0])).outcome);
    vi.unstubAllGlobals();

    seen.add(
      (
        await createSms({ provider: gatewayapi({ apiKey: 'k' }), from: 'Moovyy' }).send({
          to: '+4522680880',
          text: 'Hej',
        })
      ).outcome,
    );

    expect([...seen].sort()).toEqual([...OUTCOMES].sort());
  });
});
