import { execSync } from "node:child_process";

/**
 * PURE predicate: should a stdio MCP server exit immediately because it was
 * spawned as a Claude subagent / forked session / orphan? Running this before
 * registering tools stops a headless `claude … -p` child from corrupting the
 * parent's JSON-RPC stream (buddy's prod pattern). Opt-in — not every stdio
 * server wants it (trail is a clean ingest subprocess and leaves it off).
 */
export function shouldExitForSubagent(parentCommand: string, ppid: number): boolean {
  if (ppid === 1) return true; // orphaned — parent already gone
  if (/\bclaude\s+(?:[\w-]+\s+)*-p\b/.test(parentCommand)) return true; // headless `claude … -p`
  if (/--fork-session\b/.test(parentCommand)) return true; // forked session
  return false;
}

/**
 * Read the parent command via `ps` and exit(0) when {@link shouldExitForSubagent}
 * matches; otherwise a no-op. `onExit` is injectable for testing. If `ps` can't
 * be read, the guard stays silent (fails open).
 */
export function guardSubagents(onExit: (code: number) => void = (c) => process.exit(c)): void {
  let parentCommand = "";
  try {
    parentCommand = execSync(`ps -o command= -p ${process.ppid}`, { encoding: "utf8" }).trim();
  } catch {
    return;
  }
  if (shouldExitForSubagent(parentCommand, process.ppid)) onExit(0);
}
