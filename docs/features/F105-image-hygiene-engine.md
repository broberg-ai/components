# F105 — Image-hygiejne-motoren (components' del af cardmem-F401)

## Hvorfor
Christian 23/10 2026 (via cardmem, intercom #3976 og #3980): «opret epic og lad components tage motoren og lad job primært køre om natten (DK tid) mellem 02-05 AM» og «Kør hele 401 igennem uden stop og få components igang også.» Hans begrundelse: «Det handler primært om sikkerhed og concurency for mig.» En Fly-app der ikke er bygget om i måneder kører med de sikkerhedshuller dens basis-image havde den dag den blev bygget.

## Kontrakt med cardmem (deres #3980)
- Natstyringen (cardmem-F401.3) starter repoets `hygiene.yml` med `workflow_dispatch`, input `reason: nightly|manual`.
- Motoren melder `pipeline="image-hygiene"`, `status: ok|blocked|failed`, `detail: { critical_fixable, critical_unfixable, high, fly_release, sha }`.
- Hvert repo har en lille `hygiene.yml`: `uses: broberg-ai/components/.github/workflows/image-hygiene.yml@v1` + `secrets: inherit`.

## Arkitektur
1. **Byg uden cache, ikke udrul:** `flyctl deploy --build-only --push --no-cache --image-label hygiene-<sha>-<run>` med repoets egen `FLY_API_TOKEN` → et image i registry.fly.io.
2. **Scan det image:** Trivy mod `registry.fly.io/<app>:<label>` (login med samme token). To tal: kritiske MED rettelse (`--ignore-unfixed`), og kritiske/høje i alt.
3. **Beslut:** kritiske med rettelse > 0 → `blocked`, ingen udrulning. Ellers udrul PRÆCIS det scannede image (`flyctl deploy --image`), og meld `ok` (eller rødt hvis kritiske uden rettelse).
4. **Meld til cardmem** med kontraktens felter.
5. **Concurrency:** `group: image-hygiene-<app>`, `cancel-in-progress: false`.
6. **Renovate-preset** (`renovate/image-hygiene.json`): pinner basis-images med digest, opdaterer via PR, automerge kun sikkerhedsopdateringer og kun når repoets egne checks er grønne.

## Åbent spørgsmål (sendt til cardmem)
Hvordan en GitHub-kørsel melder til cardmem uden en delt nøgle i hvert repo. Forslag: GitHub OIDC → BID-billet (`svc:gh:<repo>`, scope til cardmem) → cardmems pipeline-endepunkt over HTTP. Indtil svaret er der, melder motoren status i kørslens summary og fejler ikke på manglende rapportering.

## Non-goals
- Natstyringen (cardmem-F401.3) og cardmems visning — cardmems del.
- Andre platforme end Fly.

## Reuse
Motoren ligger i components fordi den er fælles for hele flåden (Discovery viser den). Ingen eksisterende pakke dækker image-scanning; Trivy er standardværktøjet.

## Rollout
Workflow + preset → ref `v1` → pilot på cardmem (dens `hygiene.yml`) → bevis: sha + Fly-release → øvrige repos.
