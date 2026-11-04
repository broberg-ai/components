# F111 — @broberg/s3: store filer direkte mellem browser og S3-lager

**Bestilt af:** Christian 4/11 2026 — «Komponentet @broberg/s3 skal laves NU!!!!!!» og «Skal generelt kunne anvendes til upload og download via s3 protokollen». Første forbruger: fysio.work (fysio-work-F004) — Patrick skal sende en 8 GB video; WeTransfer tager 2 GB.

## Hvad
En pakke der lader et site modtage og udlevere filer af vilkårlig størrelse, uden at bytes passerer sitets egen server. Serveren udsteder kun korte, låste signaturer; browseren taler direkte med lageret (R2 i EU som standard, men ethvert S3-kompatibelt lager: Tigris, AWS, MinIO).

## Arkitektur
- `@broberg/s3` (server): `createS3Signer(config)` — S3 multipart (CreateMultipartUpload, presignet UploadPart, CompleteMultipartUpload, AbortMultipartUpload, ListParts) + presignet GET. aws4fetch (samme signering som @broberg/media). `createS3SignerFromEnv()` læser `S3_*`/`R2_*`; mangler noget → handleren svarer 503 (ship dark).
- `createS3Handler(signer, { authorize })` — ÉN fetch-handler (`Request → Response`), virker i Hono/Bun og Next. `authorize(req)` er SITETS hook (BID-session + allowlist) og returnerer brugerens objekt-præfiks eller `null`.
- `@broberg/s3/client`: `uploadFile(file, { endpoint })` — deler filen, N parallelle PUT direkte til lageret, retry med backoff, fremdrift (bytes, %, bytes/s, ETA), genoptag via localStorage. `downloadUrl(key)`.
- `@broberg/s3/preact`: `useUpload()` hook. **Ingen visuel komponent** — sitet ejer designet (samme linje som D-73f702).

## Sikkerhed (load-bearing)
- Nøglen forlader aldrig serveren; browseren får kun presignede URL'er med udløb ≤ 15 min, låst til ÉN objektnøgle (og ét partNumber+uploadId).
- Hver handling kræver `authorize`; objektnøglen skal ligge under brugerens præfiks (normaliseret, `..`/URL-kodning afvist) — både upload og download.
- `maxBytes` (413) og `allowedTypes` (415) håndhæves ved start.
- Kun EU-buckets som standard (D-2287db): R2-endpoint `<account>.eu.r2.cloudflarestorage.com`.

## Bucket-opsætning (forbrugerens)
CORS på bucketen: AllowedOrigins = sitets origin, AllowedMethods PUT+GET, AllowedHeaders `*`, ExposeHeaders `ETag`. Uden ExposeHeaders ETag kan browseren ikke afslutte en multipart upload.

## Non-goals
- Login/BID (sitets ansvar). Visuel dropzone (sitets design). Virus-scanning, transcoding.

## Reuse
Discovery-tjek: @broberg/media har R2/Tigris-signering (aws4fetch) men ingen presignet multipart eller browser-klient; F099.20 (web-clipper store filer → R2) løser samme problem for clipperen og bør senere bruge denne pakke. Ejeren navngav en ny pakke (@broberg/s3), så den bygges her og media/clipper kan forbruge den.

## Rollout
0.1.0 bootstrap-publish (ny pakke) → fysio.work forbruger → live-bevis med fysio.works EU-bucket (nøgle fra vaulten på id).
