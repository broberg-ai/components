/**
 * Better Auth's Drizzle adapter, re-exported so a consumer wires their DB in one
 * line:
 *
 *     import { drizzle } from "@broberg/auth/drizzle";
 *     createAuth({ database: drizzle(db, { provider: "sqlite" }) });
 *
 * WHY THIS IS A SUBPATH AND NOT ON THE CORE ENTRY (F008.9): the adapter pulls
 * `drizzle-orm` into the import graph. On the core entry that made `drizzle-orm`
 * mandatory for EVERY consumer — including one using bun:sqlite directly and
 * never touching Drizzle — while the manifest went on calling it optional. The
 * package would simply not load.
 *
 * Dark-ship is a property of the configuration; it has to be a property of the
 * import graph too, and the import graph runs first.
 */
export { drizzleAdapter as drizzle } from "better-auth/adapters/drizzle";
