# Høj tilgængelighed — 3 maskiner på 2 regioner (arn + ams)

> Fast mønster for flåden (F109.2). Anbefaling fra broberg-id (BID) 29/10 2026 (BID F084.205; fuld tekst i
> `broberg-ai/broberg-id` `docs/HA-ANBEFALING.md`). Alt er MÅLT på BID samme dag, undtagen oppetids-skønnet.
> Står ved siden af [To databaser — primær + reserve](dual-database.md): de to løser hver sin halvdel.

## Hvorfor

29/10 kunne Fly i **arn** i timevis ikke starte nye maskiner («insufficient memory», «machine can't start at the moment»). Fire udrulninger af BID fejlede i træk. De kørende maskiner var raske — men var én død, kunne Fly ikke have erstattet den. **To maskiner i én region er én fejlklasse.**

Flådens regionsregel er stadig **arn først**. ams bruges her, fordi arn er *målt* utilstrækkelig til at bære tjenesten alene — det er præcis det, regelens undtagelse er til.

## Mønsteret

| Del | Opsætning |
|---|---|
| Maskiner | 2 i arn + 1 i ams. `auto_stop_machines = false`. |
| Migrationstrin | `primary_region = "ams"` — `release_command` starter ALTID i primary region, og arn var den, der ikke kunne. Eksisterende arn-maskiner flyttes ikke. |
| Fast udgang | `flyctl ips allocate-egress --region <r>` for HVER region. En maskine uden fast udgang står ude af en IP-låst base. |
| Adgangslister | Hver regions udgang (v4 + v6) ind i basens OG reservens lister **før** første maskine i regionen starter. Kun tilføje. |
| Bevis før trafik | En prøvemaskine uden services (`flyctl machine run … --entrypoint sleep`) måler udgang, forbindelse og rundtur. Fjern den bagefter. |
| Tredje maskine | `flyctl machine clone <arn-maskine> --region ams`. |

## Det, der IKKE virker (målt)

**En slukket reserve i ams.** Fly-proxyen starter den nærmeste maskine, og danske brugere lander i ams (`fly-request-id …-ams`). Den slukkede ams-maskine blev startet ved første kald. En «kold reserve» i nærmeste region findes ikke, så længe autostart er slået til.

## Prisen for en varm ams-maskine

Basen står i Stockholm (Supabase eu-north-1).

| målt fra | rundtur til basen | et login (sign-in/email) |
|---|---|---|
| arn | 4,6 ms | 0,53 s |
| ams | 29 ms | 0,89 s |

Danske brugere får +0,35 s pr. login-trin, så længe ams tager trafikken. Vejen uden den pris: ams-maskinen sender selv forespørgslen videre til arn (`fly-replay`), så længe arn svarer — det kræver kode og test i hver app. **Prisen skal være målt og accepteret af ejeren** før en tjeneste skifter.

## Hvad det giver i oppetid (skøn, ikke målt over tid)

| Opsætning | Skøn |
|---|---|
| 2 maskiner, 1 region, 1 base | ~99,9 % (≈ 8–9 t/år) |
| 3 maskiner, 2 regioner, 1 base + indøvet manuelt basisskift | ~99,95 % (≈ 4 t/år) |
| + automatisk skift til reservebasen | næste nital |

**Det svageste led er nu basen, ikke maskinerne.** Næste nital kræver et automatisk skift til reservebasen — se [To databaser](dual-database.md).

## Tjekliste pr. tjeneste

1. Har den en fast udgang i hver region, og står de i alle adgangslister?
2. Starter `release_command` i en anden region end den, der lige er fuld?
3. Er en maskine i region nr. 2 bevist med et rigtigt kald (machine-id i svaret)?
4. Ved alarmen, hvem den skal mailes til? (BID's stod uden modtager — målt 29/10.)
5. Er prisen i svartid målt og accepteret af ejeren?

## Kilder

broberg-id #5368 (29/10 2026) · `broberg-ai/broberg-id`: `docs/HA-ANBEFALING.md` (PR #238), `fly.toml`, `docs/features/F084.205-tredje-maskine-ams.md`, `docs/features/F084.116-netvaerk-laast.md`.
