# F117 — «Kopiér kode» in every code and sign-in mail

**Owner order 26/11 2026:** «Find de løsninger der anvender en Magic Code/Link og find en løsning på hvordan de altid kan have Copy code / Kopier kode med ud i mail, så det er nemt at komme videre derfra.» Screenshot: Gmail on iPhone showing «Der er anmodet om en kode · 702501 · Kopiér kode» on an OpenRouter mail.

## What the card actually is
It is NOT a button inside the mail. Gmail («Baseret på denne mail») and Apple Mail / iOS-macOS AutoFill read the mail, recognise a one-time code, and offer the copy themselves. A mail cannot carry a working copy button of its own: mail clients run no script. So «always» is reached by writing every code mail in the shape these clients recognise — and by giving the login page a field that accepts the code from AutoFill.

The recognition is the mail clients' own and is not published as a spec. This plan therefore uses what the measurably recognised senders do (OpenRouter in the screenshot, and the large providers), and measures our own mails in the real clients before calling anything done. Nothing here is claimed to work until a real Gmail and a real iPhone show it.

## The recipe (to be measured, story F117.1)
1. **The code is in the subject, first:** `702501 er din kode til <produkt>` / `702501 is your <product> verification code`.
2. **The code is one unbroken text run in the body** — never one table cell or span per digit, never an image, no spaces inside it.
3. **A plain-text part** with the same sentence (`Din kode er 702501`).
4. **A link is never the only way in**: a magic-link mail also carries a 6-digit code the page accepts. A link-only mail can never get «Kopiér kode».
5. **The login field**: `<input autocomplete="one-time-code" inputmode="numeric">` so iOS/macOS offer the code from Mail above the keyboard.

## Inventory (measured 26/11 2026, fleet scan + source)
| Sender | Kind | Subject with code | Code unbroken | Text part | Note |
|---|---|---|---|---|---|
| BID embedded login (29 sso apps) | code | yes (`subject.slice(0,6)`) | yes (`data-mail="kode"`) | yes | likely already recognised — to be MEASURED |
| BID recovery code | code | yes («Din kode til at komme ind på BID igen: 482913») | yes | yes | code LAST in the subject — measure |
| @broberg/auth magic link (autodoc, broberg-id, cardmem, happy-little-place, trail, moovyy) | link only | no («Your sign-in link») | — | yes | can never get the card |
| cardmem — Better Auth magic link via @broberg/auth (sign-in, portal + interview invites) | link only | no («Your cardmem.com sign-in link») | — | not verified | click-through landing page (F189.24); cardmem #55685 |
| fd-sundhed A — Supabase magic link | link only | no («Dit login-link - FD Sundhed») | — | not measured | code line REMOVED 16/11 (F006.581); owner decision D-86f5ec: a code only once numbers show the link is too fragile; fd-sundhed #55682 |
| fd-sundhed B — own mail via sendEmail/Resend (private address, /onboarding) | link only | no («Dit login-link til FD Sundhed») | — | no | fd-sundhed #55682 |
| xrt81 — own login mail via @broberg/mail | link only | no («Dit login-link til X RT 81», editable by the club) | — | no | click page (/api/auth/magic) because Outlook Safe Links burned the link; 15 min; xrt81 #55683 (read in code) |
| cms — team invitation | link (not a login) | no | — | no | accepting still requires BID login; cms #55684 — outside scope |
| house-of-wellness | none | — | — | — | its team_invite template is SENT by cardmem (= cardmem row) #55686 |
| BID embedded code — APP'S OWN mail shell (F084.185, appKodeMail) | code | yes | **NO — split into two spans («486»<span>«281»)** | yes | suspected to break recognition; to MEASURE first; bid #55700 |
| BID embedded code — house shell (husetsMail) | code | yes («486281 er din kode til VN Leker») | yes (letter-spacing via CSS only) | yes | bid #55700 |
| BID link-only mails (address verification, contact address, password reset, recovery link, passkey added, invitation) | link only | no | — | yes | not login codes; outside the core scope; bid #55700 |
| pitch — invite.ts (access PIN to a pitch) | PIN + link | no («You've been invited to view: …») | **NO — one span per digit** | yes («Your access code: 482913») | pitch #55702 |
| pitch — invite-batch.ts | PIN + link | no | yes (<strong>) | yes | one mail may carry several codes; pitch #55702 |
| pitch — invite-user.ts | link only (→ BID) | no | — | — | not a code; pitch #55702 |
| cronjobs — Auth.js Resend default | link only | no («Sign in to cronjobs.webhouse.net») | — | yes | planned removed (cronjobs F011.3, BID only, waits on the owner's yes); cronjobs #55703 |
| upmetrics — status-page subscription confirmation | link only | no | — | no | not a login; click page + POST; upmetrics #55701 |
| sanneandersen — own magic link + admin invite | link only | no («Log ind hos Sanne Andersen») | — | yes | read in code, not measured; sanneandersen #55843 |
| jam — welcome, org invitation, Jambalaya newsletter confirmation | link only (no login) | no | — | yes (newsletter) | login and codes via BID (redirect + sso.embedded); newsletter moving to Beacon (F025.8); jam #56048 |
| **buzzalert (Buzz)** — 6-digit login code | code (SENT BY BID) | yes («123456 er din kode til <klient>», From «<klient> <no-reply@broberg.ai>») | yes | yes | **OWNER ORDER 27/11** («Buzz sender 6 sifrede koder og bør kunne bruge din pakke eller metode til at have en Kopier kode i sin mail»). Measured by buzzalert 27/11 (#56180, IMAP in the test mailbox + code): Buzz sends NO code mail itself — the code is BID's embedded-login mail, already in the recipe's shape. Buzz's fields (desktop-login.tsx login-code/login-second-code) already have inputMode=numeric + autoComplete=one-time-code. Buzz's own mail is only the invitation (no code). → For Buzz, F117 is owned by bid; what remains is to MEASURE that Gmail shows the card on BID's mail. |
| whop, trail, moovyy, autodoc, happy-little-place, … | ? | ? | ? | ? | asleep — the question waits in their queue (#55660 ff.) |

**A conflict found (26/11):** fd-sundhed holds an owner decision (D-86f5ec) that a 6-digit code is built only when the numbers show the link is too fragile — recipe item 4 («a link is never the only way in») goes against it for fd-sundhed. That is Christian's to settle; this plan does not override it.
Repos not checked out on this machine are measured from their own sessions (F117.1).

## Stories
- **F117.1** — measure: send one test mail per recipe variant + BID's real mails to the fleet test mailbox (webhouse.developer@gmail.com, D-2d545d) and read whether Gmail and iOS Mail show the card; finish the inventory with each sender's own session.
- **F117.2** — the shared primitive: `@broberg/mail-core` `oneTimeCodeMail({ code, product, minutes, lang, link? })` → subject, preheader, html block, text — and `@broberg/auth`'s magic-link mail gets a code alongside the link.
- **Ordered adopters (owner's words):** Buzz (27/11) — its codes are BID's mail, so the work is BID's code mail (measure, and fix the app-shell split if it breaks recognition). Every other switch is a possibility until Christian names it (D-5f65b6).
- **F117.3** — the playbook in Discovery («Kopiér kode i kode-mails») and the release report; each app's switch is a possibility, Christian decides (D-5f65b6). BID is asked first, since it carries the code mails of 29 apps.

## Non-goals
- A copy button made of HTML in the mail — it cannot work.
- SMS codes (WebOTP `@domain #code` is its own topic).

## Reuse
`@broberg/mail-core` (HTML shell primitives, D-00798e: components owns the primitives, cardmem stores templates), `@broberg/mail` (sending), `@broberg/auth` (magic link). No new package.
