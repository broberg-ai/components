# Renovate-preset: image-hygiejne (F105.2, cardmem-F401.1)

Holder Docker-basis-images **pinnet med digest** og friske — så en genbygning
(image-hygiene-workflowen, F105.1) aldrig stille trækker et andet image ind.

## Brug det

I repoets `renovate.json`:

```json
{ "extends": ["github>broberg-ai/components//renovate/image-hygiene"] }
```

## Hvad det gør

| Opdatering | Hvad sker der |
|---|---|
| Digest/pin af et basis-image | PR, **automerge kun når repoets egne checks er grønne** |
| Patch/minor/major af et basis-image | PR, aldrig automerge — det er en beslutning |
| Sikkerhedsrettelse (vulnerability alert) | PR med det samme, automerge kun bag grønne checks, label `security` |

Almindelige PR'er laves om natten (02–05 dansk tid), samme vindue som natlig
image-hygiejne. Sikkerhedsrettelser venter ikke på vinduet.

`ignoreTests` sættes aldrig: en rød PR merges ikke.

## Forudsætning

Renovate-GitHub-appen skal være installeret på organisationen (ejerens handling).

Målt 23/10 2026: appen er **ikke** installeret på `broberg-ai` (installerede apps:
claude-design-import, cardmem, claude-github-mcp-connector). Derfor er der ingen
pilot-PR på cardmem endnu. Når appen er installeret (med adgang til `components`,
så presettet kan læses, og til `cardmem`), er piloten én fil i cardmem:
`renovate.json` med linjen ovenfor.

Valideret med `renovate-config-validator --strict` både som global og som
repo-konfiguration; et forkert feltnavn giver rødt (negativ kontrol).
