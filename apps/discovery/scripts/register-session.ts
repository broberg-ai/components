// F038.28 — register a new Discovery session (the path server.ts and the fleet
// CLAUDE.md point at). Ops only; there is deliberately no HTTP route. Run where
// TURSO_DATABASE_URL/TURSO_AUTH_TOKEN are set, with the key on stdin so it never
// lands in argv or shell history:
//   bun scripts/register-session.ts <session> < keyfile
import { registerSession } from "../enroll";
const session = process.argv[2] ?? "";
const key = (await new Response(Bun.stdin.stream()).text()).trim();
const r = await registerSession(session, key);
console.log(r.ok ? `registered ${session}` : `refused: ${r.error}`);
process.exit(r.ok ? 0 : 1);
