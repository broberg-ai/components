# @broberg/gravatar

Gravatar URLs and avatar initials for the fleet. Zero runtime dependencies, isomorphic.

```bash
npm i @broberg/gravatar
```

```ts
import { gravatarUrl, gravatarLookup, getInitials } from "@broberg/gravatar";

await gravatarUrl("cb@webhouse.dk", { size: 80, default: "404" });
await gravatarLookup("cb@webhouse.dk");   // 'yes' | 'no' | 'unknown'
getInitials("Christian Broberg");          // 'CB'
```

Also ships `@broberg/gravatar/react` and `@broberg/gravatar/preact`.

## `gravatarLookup()` — three outcomes, because there are three

```ts
const presence = await gravatarLookup("cb@webhouse.dk");
if (presence !== "unknown") cache.set(email, presence);   // never cache a guess
```

| Response | Result | Meaning |
|---|---|---|
| `404` | `no` | genuinely no avatar |
| `200` | `yes` | |
| 5xx · a throw · a timeout · a surprise status | `unknown` | **do not cache this as a no** |

**Why it exists (v0.2.0).** The old boolean collapsed three facts into two: a 503 from Automattic and a dropped connection both came back `false`, which reads as *"there is no picture"*.

And you **cache** that answer — you have to, or you ask Automattic on every page render. So a ten-second hiccup cost a user their avatar until the cache expired, with nothing at the call-site able to tell. Found by a consumer on the day they adopted this package.

`gravatarExists()` is unchanged for existing callers and **still cannot tell those two apart** — both are `false`. If you store its result, you are storing a guess on every failure. Use `gravatarLookup` for anything you cache.

## `getInitials()` — letters, not characters

```ts
getInitials("Lens (verifikation)");   // 'LV'    (was 'L(' before v0.2.0)
getInitials(null, "x@webhouse.dk");   // 'X'     (was 'X@')
getInitials("  ");                    // '??'    (was two spaces)
getInitials("李 明");                  // '李明'
getInitials("José");                  // 'JO'
```

Splits on non-letter/non-digit, unicode-aware — so CJK and accented Latin work, which an ASCII-only test suite would never have caught.

The email branch takes the **prefix** before `@`. That is what its documentation always claimed; the code read the whole address and only looked right because most addresses happen to begin with two letters.

**Known limitation, deliberate.** `getInitials("Jens Hansen, direktør")` returns `JD` — it takes the title as the surname. Truncating at the first comma would fix the Danish *"Name, Title"* form and **break** the equally common *"Surname, Firstname"* export. Two conventions, opposite fixes, and nothing in the string to tell them apart. Left alone rather than guessed at.

## The core is `async`, on purpose

`gravatarHash` and `gravatarUrl` return promises because they use `crypto.subtle` — the one hashing API that exists in Node, Bun, Deno, workers *and* the browser.

A Node-only consumer expects a synchronous `createHash` and will be surprised. That is the isomorphism tax, and it is deliberate: the alternative is two code paths and a bundler condition on every consumer.

## API

| Export | |
|---|---|
| `gravatarHash(email)` | SHA-256 of the trimmed, lowercased address |
| `gravatarUrl(email, { size?, default? })` | the full image URL |
| `gravatarLookup(email, size?)` | `'yes' \| 'no' \| 'unknown'` |
| `gravatarExists(email, size?)` | `boolean` — lossy; see above |
| `getInitials(name?, email?)` | up to two uppercase characters, or `'??'` |
