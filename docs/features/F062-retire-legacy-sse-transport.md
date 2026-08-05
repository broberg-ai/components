# F062 — Pensionér den gamle HTTP+SSE-transport i `@broberg/mcp`

**Status:** planned · **Prioritet:** low · **Oprettet:** 2026-08-05

## Motivation

MCP-specifikation **2026-07-28** omklassificerer HTTP+SSE-transporten til formelt **Deprecated** under en nyindført feature-lifecycle-politik ([SEP-2596](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2596)). Transporten har været blødt udfaset siden `2025-03-26`; nu er der sat et ur på den.

**Der er ingen hast.** Lifecycle-politikken garanterer **mindst 12 måneders** deprecation-vindue, så tidligste fjernelse er ~august 2027. Transporten virker uden begrænsning indtil da. Dette kort findes for at sikre at pensioneringen sker planlagt — ikke som et hastefix den dag en SDK-opgradering pludselig fjerner den.

## Udgangspunktet er bedre end det lyder

`@broberg/mcp` (v0.4.0) kører **allerede** Streamable HTTP:

- `packages/mcp/src/http.ts` → `WebStandardStreamableHTTPServerTransport` (den nuværende, ikke-udfasede transport)
- `packages/mcp/src/sse.ts` (96 linjer) + `packages/mcp/src/web-sse.ts` (193 linjer) → legacy-stien

Pakken er altså ikke låst til noget døende. Opgaven er at **fjerne den gamle sti**, ikke at bygge en ny — hvilket gør den væsentligt mindre end den lyder.

## Scope

1. **Consumer-audit først.** `@broberg/mcp` er en publiceret delt pakke. Kortlæg hvilke repos/apps der faktisk importerer SSE-eksporten, før noget røres. Uden den liste er enhver fjernelse et gæt.
2. **Marker som udfaset i pakken selv** — JSDoc `@deprecated` + en note i README med den planlagte fjernelsesdato, så en ny consumer ikke når at adoptere den på vej ud.
3. **Migrér hver consumer** til Streamable HTTP og bevis det pr. consumer.
4. **Fjern først når listen er tom** — og i et major-bump, aldrig i en patch.

## Non-goals

- **Migration til SDK v2** (`@modelcontextprotocol/server@2`). Separat, langt større beslutning: v2 kræver zod ≥ 4.2, og 7 af flådens 9 MCP-repos kører zod 3. Den migration rører al dataviladering i de repos, ikke kun MCP-delen. Tages når der er en tvingende grund.
- Stateløs-redesignet (fjernelse af sessions). Gevinsten er horisontal skalering; ingen af vores MCP-servere kører mere end én instans i dag.
- Ændring af auth-stien (`oauth*.ts`, `three-tier-auth.ts`).

## Afhængigheder

- Consumer-listen fra punkt 1 blokerer alt det øvrige.
- `@modelcontextprotocol/sdk` v1 vedligeholdes fortsat (1.30.0 udgivet 2026-07-27, IKKE deprecated på npm), så der er intet SDK-pres bag dette.

## Reuse

Dette ER den delte pakke — `@broberg/mcp` er flådens MCP-primitiv. Der er intet at genbruge udefra; pointen med kortet er netop at holde ÉN transport-implementering ét sted i stedet for at hver consumer håndterer deprecationen selv.

## Rollout

1. Consumer-audit → skriv listen ned i dette dokument.
2. Deprecation-markering i pakken (ikke-brydende, kan ske med det samme).
3. Consumer-migration, én ad gangen, hver bevist.
4. Fjernelse i major-bump, når og kun når listen er tom.

**Ingen naked cutover:** SSE-stien bliver liggende og virker indtil hver eneste consumer er bevist flyttet. Rebuild, bevis, DEREFTER fjern.

## Kilde

Spec-changelog: https://modelcontextprotocol.io/specification/2026-07-28/changelog (afsnit "Deprecated", punkt 2). Verificeret mod npm 2026-08-05: `@modelcontextprotocol/server@2.0.0` og `/client@2.0.0` udgivet 2026-07-27; `@modelcontextprotocol/sdk@1.30.0` udgivet samme dag og ikke markeret deprecated.
