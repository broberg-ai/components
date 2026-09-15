# F084 — Broberg ID (BID)

**Status:** Ready · **Skrevet:** 2026-09-16 · **Kilde:** Christians `SSO-PLAN.md` (15. sep.), efterprøvet før kortene

## Målet

Én bruger, ét login, alle apps. `id.broberg.ai` er vores pendant til
`connect.visma.com`. Samme kodebase skal kunne sælges til en kunde som deres
EGEN tenant på deres EGET domæne — `id.fdaalborg.dk`, `id.fdgo.dk`,
`id.fdnow.dk`. Det er i sig selv en flagship-løsning til broberg.ai-sitet.

Og: ingen eksisterende app må gå i stykker undervejs.

## Målt før noget blev planlagt

| Påstand | Måling |
|---|---|
| "byg videre på authmem-kodebasen" | **authmem findes ikke.** 6 orgs + personlige repos, 0 træf. Bekræftet af ejeren: en idé til et domæne. Fase 0 er BYGGE. |
| `@better-auth/oauth-provider` | **1.7.5**, samme version som better-auth |
| betroede apps springer samtykke | `skip_consent: true` — findes |
| central udlogning | `/oauth2/end-session` **+ `backchannel_logout_uri`** med signeret logout-token — indbygget |
| "ingen login-prompt i app B" | `prompt=none` understøttet siden 1.5 (feb. 2026) |
| passkeys | `rpID` bindes til auth-serverens oprindelse |

### To af mine egne indvendinger faldt

Jeg advarede om at *"log ud overalt"* og *"ingen login-prompt i app B"* ikke
kunne bygges. Begge har førsteklasses understøttelse. Det står her, fordi jeg
havde ret i **formen** og forkert i **konklusionen** — og en advarsel man ikke
måler koster lige så meget som en fejl man ikke finder.

### ⚠️ Den der står ved magt, præciseret

Serveren kan `prompt=none`. **Leveringsmåden** afgør om det virker:

| vej | virker? |
|---|---|
| skjult ramme (iframe) mod IdP'en | **nej** — tredjepartskontekst. Safari blokerer, Chrome afvikler |
| fuldt sideskift | **ja** — førstepartskontekst, alle browsere |

Samme skel for logout: server-til-server virker, skjulte rammer gør ikke.
Bygges den skjulte vej, virker alt i test på en Mac og fejler for hver bruger
på iPhone — **den værste slags fejl, fordi den ser grøn ud hos os.**

## Session-levetider — besluttet 16. sep.

| | |
|---|---|
| app, standard | **7 dage**, rullende (fornyes ved brug) |
| app med person-/helbredsdata (fd-sundhed) | **12 timer** + ny login efter 30 min uden aktivitet |
| stille tjek mod BID | **1 time** |
| BID's egen kontoflade | **1 time** |

### Hvad andre gør — målt, ikke husket

| | |
|---|---|
| Google Workspace | 14 dage · **admin-konsollen 1 time**, kan ikke ændres |
| Microsoft Entra | adgang 60-90 min · fornyelse op til 90 dage |
| Better Auth (vores) | 7 dage, rullende, fornyes efter 1 dags brug |
| NIST niveau 1 | højst 30 dage, inaktivitet valgfri |
| NIST niveau 2 | højst **12 timer** + 30 min inaktivitet ← helbredsdata |

**7 frem for 14**, fordi 7 er værktøjets egen standard: vælger vi 14, skal
nogen ændre noget og huske hvorfor. Gevinsten ved de syv ekstra dage er at
brugeren logger ind halvt så sjældent — for lidt mod at have et tal ingen har
rørt.

**12 timer på fd-sundhed**, fordi den rører helbredsdata. Ét tal til alle apps
ville enten være for løst dér eller for stramt i cardmem.

### ⚠️ BID har TO sessioner, ikke én

Ejeren: *"BID skal have sit eget login jo, så det er 1 time som Google admin."*
Rigtigt — og Google har **to ure på samme konto**, ikke ét:

| | holder | vores |
|---|---|---|
| **SSO-sessionen** | dig logget ind i ALLE apps. Det `prompt=none` spørger om | 7 dage |
| **konto-sessionen** | din ret til at ÆNDRE kontoen: tilføje en nøgle, skifte primær mail, slette | 1 time |

Kollapses de til én, får vi ét af to dårlige udfald:

- **1 time på begge** → hele flåden kræver login hver time. Ubrugeligt.
- **7 dage på begge** → fladen hvor man kan overtage alt står åben en uge på en
  ulåst maskine.

Så: at åbne kontosiden (F084.9) kræver en konto-session under 1 time gammel. Er
den ældre, bekræfter brugeren sig igen — **uden at miste sin adgang til apps.**
Det er trin-op-mekanismen fra F084.15, brugt på hele fladen frem for på en
enkelt handling. **De to kort deler den kode; de bygger den ikke hver for sig.**

### Hvorfor det stille tjek findes

Med back-channel logout er udlogning øjeblikkelig. Timen er **nettet under
den**: en app der var nede da beskeden gik ud, får den aldrig — og er så logget
ud inden for en time i stedet for at hænge i syv dage. Uden det tal er "log ud
overalt" et løfte der holder indtil én app har en dårlig dag.

## Multi-tenant på eget domæne

Ejeren, 16. sep.: *"store kunder som FD Aalborg der snart har 3 systemer kan få
deres egen tenant udgave af BID på en selvstændig URL som kun tilhører dem."*

**Det er ikke branding. Det er et separat legitimations-univers.** Grunden er
passkeys: en adgangsnøgle bindes til domænet. En nøgle oprettet på
`id.fdaalborg.dk` virker ikke på `id.broberg.ai` og omvendt. Det er præcis den
isolation en kunde skal have — og det betyder at **et tenant-domæne aldrig kan
skiftes bagefter** uden at hver bruger skal oprette sin nøgle igen.

### Prisen ingen tænker på

Hver tenant skal have **sine egne oprettelser** hos Google, GitHub, Microsoft,
Apple og LinkedIn. Redirect-adresser er pr. domæne, og samtykkeskærmen viser
udbyderens eget app-navn — en kunde kan ikke låne broberg.ai's. Apples
`client_secret` fornyes hver 6. måned, så **N tenants = N fornyelser**.
Automatiseres det ikke fra start, er det tilbagevendende nedetid med et halvt
års lunte.

### Hvem bor hvor (besluttet)

BID rummer **mennesker der arbejder i systemerne**. Kundernes egne slutbrugere
— en patient der booker, en der handler i en shop — hører ikke i broberg.ai's
register. Har en kunde behovet, får de deres egen tenant.

Better Auths `organization`-plugin er **målt uegnet** til striks multi-tenancy
(brugere er globale, én mail = ét menneske, ingen per-tenant isolation). Så
isolationen leveres af **separate udrulninger**, ikke af kolonner i en fælles
base. Adskillelsen bliver infrastruktur frem for kode — og en fejl i koden kan
derfor ikke lække på tværs.

## Arkitektur

```
   id.broberg.ai            id.fdaalborg.dk          id.fdgo.dk
   (egen base, egne         (egen base, egne         (…)
    social-nøgler,           social-nøgler,
    egne passkeys)           egne passkeys)
        │                        │
        │  OIDC (authorization code + PKCE)
   ┌────┼────┐                   ┌────┼────┐
 cardmem  X RT 81            FD-system 1  …
   @broberg/sso                @broberg/sso
```

**Apps beholder** egen database, egne roller og rettigheder. Autorisation
(*hvad må du*) er app-lokal; autentifikation (*hvem er du*) er central. Den
lokale brugertabel får `sso_sub` som kobling.

## Reuse

Discovery-tjek kørt på auth · sso · single sign-on · oidc · passkey · identity.

| Pakke | Rolle i BID |
|---|---|
| `@broberg/auth` | **fundamentet.** BID bygger på samme Better Auth-lag. Pakken bliver stående urørt til legacy-apps og fryses når `@broberg/sso` er ude |
| `@broberg/mail` | verifikationsmail, kontogendannelse. **Ingen rå Resend i BID** |
| `@broberg/sms` | tofaktorkoder på SMS. Ingen rå gateway |
| `@broberg/theme` | tokens — men broberg.ai har sin EGEN palet (cms leverede den), ikke theme-presettet |
| `@broberg/logger` | server-log der redigerer legitimationsoplysninger ud |
| `@broberg/cron` | Apple client_secret-rotation pr. tenant |

**Ingen eksisterende pakke løser OIDC-provider-rollen.** `@broberg/auth` er en
Better Auth-*wrapper* for én app; BID er en *tjeneste*. Ny pakke
`@broberg/sso` (klienten) er altså berettiget — og den skal være tynd:
adgangskoder, passkeys og udbyder-nøgler hører i BID, aldrig i klienten.

## Non-goals

- **Ikke** en ekstern SSO-platform (Auth0, Clerk, Okta). Better Auth fortsætter.
- **Ikke** kundernes slutbrugere i broberg.ai's register.
- **Ikke** central autorisation. Roller forbliver app-lokale (kan genbesøges).
- **Ikke** enterprise-SAML i denne omgang.
- **Ikke** en ombygning af `@broberg/auth`. Den fryses, den rives ikke ned.

## Rollout

Kernen først, én app ad gangen bagefter, cardmem sidst. Kontosiden er sent i
rækkefølgen, fordi den viser det de tidligere trin producerer.

## Mockups

- `/mockups/01a0a6a2-6105-7ecd-a229-a007d2daddfe` — login-tilstandene (8)
- `/mockups/01a0a6b2-a356-71dc-bf64-1d39cead688c` — Mine apps + Kontoindstillinger

Farver fra broberg.ai's egen `brand.css`, leveret af cms. **To ting der ikke må
forsimples:** flade-farve og tekst-farve er forskellige tokens (kontrast), og
teksten på den blå knap er mørk, ikke hvid.
