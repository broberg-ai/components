# F087 — Egne CI-maskiner (self-hosted GitHub Actions-runners)

**Status:** Ready · **Ordre:** Christian 29/9 «GO» på en pilot efter spørgsmålet om eget CI (hurtigere, ingen $30-50/md, parallelt).

## Valget: runners, ikke eget CI-system

Vi beholder GitHub Actions (workflows, logs, required checks, OIDC-publish) og lader egne maskiner udføre jobbene. GitHub fakturerer ikke minutter på self-hosted runners. Et eget CI-system ville skulle genopfinde alt det, og det ville koste mere end det sparer.

## Målt før (baseline, 29/9)

components test.yml, 15 seneste grønne kørsler, vægur-minutter: 3 7 1 8 7 2 1 5 1 8 1 1 7 1 1. Varierer meget (kø + cache-misses). 52 jobs i components kører på ubuntu-latest.

## Design

- **Maskine:** cb-ubuntu (Linux x64, altid tændt). IKKE ejerens M1: beslutningsregistret forbyder lokale docker-builds dér.
- **Registrering:** org-niveau-runner i broberg-ai, label `cb-ubuntu`, kørt som systemd-service af den session der allerede kører på cb-ubuntu. Nøgler går aldrig over intercom.
- **Sikkerhed, den vigtige:** 10 af org'ens 35 repos er OFFENTLIGE, heriblandt components. På et offentligt repo kan en fremmed åbne en PR, hvis kode så kører på vores maskine. Derfor: runner-gruppen må kun bruges af udvalgte repos, og i offentlige repos vælges vores maskine KUN for push til main og tags, aldrig for `pull_request`. Håndhæves i workflowet, så det ikke afhænger af at nogen husker det.
- **Omvej når maskinen er nede:** repo-variablen `CI_RUNNER` vælger maskinen. Tom = GitHub's maskiner. Én ændring flytter alt tilbage. Automatisk failover findes ikke i Actions, så det er en bevidst manuel kontakt, og en alarm skal fortælle hvornår den skal bruges.
- **Parallelt:** flere runner-processer på samme maskine, hver med sin mappe. Pilot starter med 2.

## Stories

- **F087.1** — Runner op på cb-ubuntu (org-niveau, label, systemd, begrænset til udvalgte repos).
- **F087.2** — components' test.yml vælger maskine via `CI_RUNNER`, aldrig vores maskine for pull_request; målt før/efter.
- **F087.3** — Alarm når runneren er offline (script, ikke LLM: D-13a919), og en beskrevet omvej.

## Ud af scope

- Andre repos end components, før piloten er målt.
- macOS-builds (xcodebuild) — kæver en Mac, og M1'en er udelukket.

## Reuse

Discovery 29/9: ingen eksisterende runner-opskrift i flåden. Vi genbruger GitHub's egen runner-software og vores eksisterende workflows uden ændringer ud over `runs-on`.
