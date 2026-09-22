# F086 — `@broberg/media`: to providere, to forskellige svar på den samme farlige nøgle

> **Meldt af `broberg-id` 22. september 2026**, ramt i praksis da de flyttede BID's avatarlager fra `volume` til `r2`.
> **Efterprøvet her førstehånds** mod den udgivne kode og mod en rigtig URL-parser — ikke ræsonneret, og ikke taget på deres ord.

---

## Hvad der er galt

Facadens løfte er at `provider` er en konfigurationsværdi: skift den, og dine kaldesteder er uændrede. **Her er skiftet også en sikkerhedsændring, i den forkerte retning, og intet siger fra.**

| provider | samme nøgle `../x` |
|---|---|
| `volume` | `safeSegments()` afviser → `media(volume): key escapes the root` |
| `r2` | `normalize()` strimler kun førende skråstreger → nøglen sendes videre |

`encodeKey()` kører `encodeURIComponent` pr. segment, og **`encodeURIComponent("..") === ".."`** — et punktum kodes ikke. Så `..` overlever kodningen, lander i URL'en, og URL-parseren kollapser den præcis som en browser gør.

### Målt, med en negativ kontrol

```
nøgle  "../../andet-bucket/hemmelig.txt"   keyPrefix "tenant-a/"
  bygget   …/bid-avatarer/tenant-a/../../andet-bucket/hemmelig.txt
  URL ser  …/andet-bucket/hemmelig.txt            ← BUCKET-NAVNET VÆK

nøgle  "../tenant-b/privat.jpg"
  bygget   …/bid-avatarer/tenant-a/../tenant-b/privat.jpg
  URL ser  …/bid-avatarer/tenant-b/privat.jpg     ← SAMME bucket, ANDEN tenant

nøgle  "normal/avatar.png"                        ← negativ kontrol
  URL ser  …/bid-avatarer/tenant-a/normal/avatar.png   bucket ✓ præfiks ✓
```

**Det andet tilfælde er det alvorlige, og det er ikke det man ser først.** Bucket-udbruddet kan et bucket-afgrænset token stoppe med 403 — der findes altså et lag under os der *kan* redde den. Tenant-springet bliver inden for den bucket tokenet lovligt må røre og overtræder kun `keyPrefix`. **Ingen credential-afgrænsning stopper den, fordi der ikke er nogen grænse tilbage at overtræde.** Og `keyPrefix` er præcis det vi sælger som flerkunde-isolation.

## Hvem er ramt

Målt i tarballene fra npm, med `cloudflarestorage` som positiv kontrol så nullerne er et svar og ikke en grep der aldrig kiggede:

| version | r2 | `encodeURIComponent` | nøglevagt |
|---|---|---|---|
| 0.1.0 | ✓ | ✓ | **ingen** — heller ikke på `volume` |
| 0.2.1 | ✓ | ✓ | **ingen** — heller ikke på `volume` |
| 0.3.0 | ✓ | ✓ | kun på `volume` |

**Alle tre udgivne versioner er sårbare på `r2`.** Ifølge Discoverys tilmeldinger kører **xrt81 på 0.1.0** og **fd-sundhed på 0.2.1** i produktion. Ingen af dem har hørt om det endnu.

> **Udnyttelsen kræver at en angriber kan påvirke nøglen.** Det gør BID's `/media/*`-rute, og derfor fandt de den. Om xrt81 og fd-sundhed gør det, **ved jeg ikke** — det er deres kode, ikke min, og jeg gætter ikke på det. Meldingen til dem skal derfor beskrive egenskaben og lade dem afgøre om deres nøgler er brugerstyrede.

## Løsningen

**Én vagt, ét sted, begge providere.** `safeSegments` løftes ud af `volume.ts` til et fælles modul og kaldes også i r2's nøglesti (`fullKey`).

To kopier af en sikkerhedsregel er præcis den drift `@broberg/mail-identity` (F070) blev bygget for at fjerne — og dér blev det målt at **begge** uafhængigt skrevne kopier havde huller. Det er den erfaring der afgør formen her: ikke «ret r2 også», men «der må kun findes én regel at rette».

**Afvis, kast ikke anderledes.** r2 skal fejle på samme form som volume, så en forbrugers `catch` ikke behøver kende provideren. Beskeden bør navngive provideren (`media(r2):`) som volume gør, så en log stadig siger hvor det skete.

**Hvad der IKKE ændres:** en lovlig nøgle skal opføre sig fuldstændig uændret — `normal/avatar.png`, punktum i filnavne (`avatar.v2.png`), unicode, mellemrum.

## Version

**Patch**, hvis den er ikke-brydende for enhver lovlig nøgle — og det er den rigtige retning her: under `1.0.0` er npm's caret patch-only, så en patch trækkes ind automatisk hos `^0.3.0`-forbrugere. For en sikkerhedsrettelse er den automatik gevinsten, ikke risikoen.

**Men xrt81 (0.1.0) og fd-sundhed (0.2.1) når den ikke** — caret på `^0.1.0` og `^0.2.1` følger ikke med til 0.3.x. De skal have en melding og tage et bevidst bump. **Det er hele grunden til at rettelsen ikke er færdig når den er udgivet.**

## Reuse

| Kapacitet | Findes der noget? | Beslutning |
|---|---|---|
| Sti-normalisering | `safeSegments` i vores egen `volume.ts` | **Genbrug den.** Den er allerede den strengere af de to og har været i produktion; at skrive en ny ville give en tredje mening om samme regel |
| Sti-primitiv fra en pakke | Ingen `@broberg/*` ejer sti-sikkerhed | Ikke værd at udskille som egen pakke for én funktion — den hører hvor den bruges |
| Fortilfælde for formen | `@broberg/mail-identity` (F070): to kopier af én sikkerhedsregel, huller i begge | **Genbrug lektien**, ikke koden. Derfor én definition, ikke to rigtige |

## Rollout

1. Vagten løftes ud og bruges af begge providere. Suiten grøn, lovlige nøgler uændrede.
2. Mutationsprøve: fjern vagten fra r2 → kun traverserings-prøverne bliver røde. Antallet noteres, så «noget fejlede» ikke forveksles med «den rigtige fejlede».
3. Udgiv. Verificér på **det en forbruger får** — `npm pack` i en tom mappe, kør traverserings-prøven mod tarballens `dist`, med den forrige version som negativ kontrol der skal FEJLE.
4. Advisér xrt81, fd-sundhed og broberg-id: version, hvad der ændrede sig, om det er brydende, og at ældre versioner er svækkede på r2.
5. Registrets `ver` opdateres først når pakken er verificeret på npm — ikke når workflowet er grønt.

## Det andet gap, som IKKE er dette kort

broberg-id meldte samtidig at r2-provideren hardkoder `${accountId}.r2.cloudflarestorage.com` uden `endpoint`-override, så facaden ikke kan nå Tigris eller noget andet S3-kompatibelt — og at fire repoer i flåden bruger Tigris/S3 uden om os af netop den grund. **Det er et rigtigt hul i facadens dækning, men det er en funktion, ikke en sårbarhed.** Holdes adskilt med vilje: en sikkerhedsrettelse der rejser med en ny funktion er sværere at udgive hurtigt og sværere at bedømme. Eget kort.

## Hvad der IKKE er bevist her

- Om xrt81's og fd-sundheds nøgler er brugerstyrede. Ikke undersøgt — deres kode, deres svar.
- Om R2's egen server afviser en `..`-sti før den rammer et objekt. Irrelevant for tenant-tilfældet (stien er lovlig efter normalisering), men uafklaret for bucket-tilfældet.
- Om `publicUrl()` har samme egenskab som `objectUrl()`. Den bruger samme `encodeKey(fullKey(...))`, så den formodes ramt — men det skal måles, ikke antages.
