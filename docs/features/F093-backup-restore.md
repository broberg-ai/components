# F093 — `@broberg/backup`: backup og gendannelse til R2

> **INTERIM PLAN — åbne spørgsmål øverst.** Nr. 4 i rækkefølgen aftalt med appkit 4/10; stories med AC skrives, når vi når hertil. Ingen kode før da.

## Åbne spørgsmål

1. Hvad tages der backup af? SQLite/libSQL (Turso), Postgres (db-sdk 0.2), filer i et volume — én eller flere?
2. Hvem gendanner, og hvordan bevises det? En backup, der aldrig er gendannet, er ikke en backup: gendannelse til en tom instans skal være en del af testen.
3. Opbevaring og sletning: hvor mange versioner, og hvordan håndteres GDPR-sletning i gamle backups?
4. Kryptering: klient-side før upload, nøgle i vaulten?
5. Hvor findes der allerede backup-kode i flåden (cardmem? cms?), som bør være kilden?

## Ramme

- Lagring via `@broberg/media` (R2 eu-jurisdiction, keyPrefix pr. tenant) — ingen rå S3-klient.
- Kerne + tynde adaptere; planlægning via cronjobs.webhouse.net / `@broberg/cron`, ikke `setInterval`.
- Sletning (DROP/restore over en levende database) er en destruktiv handling og kræver Christians egne ord.

## Reuse

Discovery: ingen backup-pakke. Bygger på `@broberg/media` 0.4 og `@broberg/cron`.
