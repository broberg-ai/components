# F095 — Kontoside i appen

**Kilde:** Christian 5/10 via appkit #1735/#1767 (appkit-F004.3): «en Almindelig side i alle apps der viser kontoen, og evt. via API til broberg-id kan redigere eks. navn og avatar billede … meget disruptivt pludselig at forlade et system man kender». Meldt som fejl: «Konto» åbner stadig id.broberg.ai.

## BID's API (i drift, id.broberg.ai/llms.txt trin 7a)
Fra appens SERVER med brugerens `access_token`: `GET /api/app/profile` → `{sub, name, picture, email, account_url}` (scope `profile`); `POST /api/app/profile {name}`, `POST /api/app/profile/avatar` (rå bytes, ≤ 2 MB, PNG/JPEG/WebP), `POST /api/app/profile/avatar/remove` (scope `profile:write`). Kun tokenets egen bruger. Mail, adgangskode, nøgler, 2FA og sessioner bliver i BID → link til `account_url` i ny fane.

## Hullet i dag
`@broberg/sso` 0.8.0's `completeLogin` modtager `accessToken`/`refreshToken`, men `ssoRoutes` smider dem væk; sessionen (cookie) har kun sub/exp/iat/email. Appen kan derfor ikke kalde profil-API'et.

## Design
1. **F095.1 — tokens server-side i sso (auth, load-bearing):** `TokenStore`-interface (`get/set/delete` på et session-id), et `sid` i sessionen, tokens ALDRIG i cookien. `getAccessToken(c)` i hono-delen fornyer med refresh_token, når det er udløbet, og gemmer det nye par. Log ud sletter. Standard-store i hukommelsen med en navngiven advarsel (mistes ved genstart, deles ikke mellem maskiner); appen giver sin egen (SQLite/Redis).
2. **F095.2 — profil-klient + router i sso:** `getProfile/updateProfile/uploadAvatar/removeAvatar` på klienten (genbruger `appPost`-mønstret fra `addressOwnership`), og `accountRoutes()` til hono, så appen monterer `/api/account/*`. Størrelse/type tjekkes før afsendelse; manglende `profile:write` gives som en navngiven fejl, ikke en tavs 403.
3. **F095.3 — AccountPage i app-shell (Preact):** avatar (rund, upload/fjern med feedback), navnefelt med gem der VISER DET SERVEREN SVAREDE (genlæst, ikke optimistisk), link til `account_url` i ny fane. Adapter (`load/saveName/uploadAvatar/removeAvatar`) med standard-fetch til `/api/account/*`. Testid'er, ingen native dialoger, 393 px.

Rækkefølge: .1 → .2 → .3. Hver sso-udgivelse adviseres til broberg-id og kendte forbrugere før nogen bedes opgradere (D-4d0783).

## Reuse
Discovery: `@broberg/sso` ejer BID-integrationen (udvides, ikke ny pakke); `appPost` i sso genbruges; app-shell ejer UI'en (Avatar fra F092.3 genbruges). components-F012 «Profile + image upload» (ejer xrt81) er en lokal profil-store — denne epic bruger BID som eneste kilde (D-1dc849: ingen anden billed-store).