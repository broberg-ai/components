# @broberg/phone

Ring a person over the phone network — **46elks** (Swedish, personal data kept in the EU) —
play a message, ask for **one key press to acknowledge**, and learn how the call went.
Built for an alarm that must wake someone.

- `call()` **never throws**; a failure carries a `kind`: `auth` (fix the keys) · `payload` (fix the
  request) · `transient` (try again).
- `status` at boot: `ready` · `no-keys` (deliberate dark ship) · `invalid-keys` (a bug).
- **46elks does not sign webhooks.** Every webhook URL the package builds carries your secret, and
  `parseHangup` / `parseIvr` refuse a request without it. 46elks also recommends a firewall on their
  IPs (`176.10.154.199`, `85.24.146.132`, `185.39.146.243`, `2001:9b0:2:902::199` — they mail
  customers when it changes).
- Phone numbers appear **masked** (`+45******78`) in every reason the package writes.

Zero dependencies, no database.

## The message is audio

46elks has no text-to-speech in production ("We are working on a TTS feature"), so the call
**plays a URL**. Make the Danish audio with `@broberg/ai-sdk` (Azure, `westeurope`, MP3) and host it:

```ts
import { createAI } from "@broberg/ai-sdk";
import { createPhone } from "@broberg/phone";

const ai = createAI();
const phone = createPhone({
  username: process.env.ELKS_USERNAME,
  password: process.env.ELKS_PASSWORD,
  from: process.env.ELKS_FROM,                 // your voice-enabled 46elks number, E.164
  webhookSecret: process.env.ELKS_HOOK_SECRET, // ≥ 16 chars, e.g. openssl rand -hex 32
});
if (phone.status !== "ready") log.warn("calls dark:", phone.statusReason);

const audio = await ai.tts({ text: "Alarm på pumpe 3. Tryk 1 for at kvittere.", language: "da" });
const audioUrl = await storage.putPublic(`alarms/${alarm.id}.mp3`, audio); // your hosting

const r = await phone.call("+4512345678", {
  audioUrl,
  webhookBase: "https://buzz.example/hooks/elks",
  ackDigit: "1",
  timeoutSeconds: 45,
});
if (!r.ok) log.warn(r.kind, r.reason);            // e.g. retry on transient, alarm on auth
```

## The two webhooks

Both arrive form-encoded at `webhookBase` (`?event=ivr` and `?event=hangup`). Pass the parsed
form body and the full request URL:

```ts
app.post("/hooks/elks", async (c) => {
  const body = new URLSearchParams(await c.req.text());
  const url = c.req.url;
  if (new URL(url).searchParams.get("event") === "ivr") {
    const p = phone.parseIvr(body, url);
    if (!p.ok) return c.text("", 403);
    if (p.event.acknowledged) await alarms.ack(p.event.callId);
    return c.json({ hangup: "" }); // 46elks reads the next action from the response
  }
  const p = phone.parseHangup(body, url);
  if (!p.ok) return c.text("", 403);
  await alarms.callEnded(p.event); // { callId, outcome: answered|busy|failed, neverAnswered, durationSeconds }
  return c.text("");
});
```

`outcome` mirrors 46elks' `state` (`success` → `answered`, `busy`, `failed`). There is no separate
"no answer" state at 46elks; `neverAnswered` is true when the hook has no pickup time — not yet
verified against a live call.
