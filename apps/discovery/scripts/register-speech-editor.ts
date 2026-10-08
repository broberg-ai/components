// F044.3 — register a speech-dictionary editor. Ops only; there is deliberately
// no HTTP route for this. Run where TURSO_DATABASE_URL/TURSO_AUTH_TOKEN are set
// (fly ssh console -a broberg-discovery), with the editor's key read from stdin
// so it never lands in argv or shell history:
//   bun scripts/register-speech-editor.ts <session> < keyfile
import { registerEditor } from "../speech-dictionary";
const session = process.argv[2] ?? "";
const key = (await new Response(Bun.stdin.stream()).text()).trim();
const r = await registerEditor(session, key);
console.log(r.ok ? `registered ${session}` : `refused: ${r.error}`);
process.exit(r.ok ? 0 : 1);
