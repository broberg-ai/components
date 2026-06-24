/** The audit record shape — the cms-mcp-server JSONL log, extracted 1:1. */
export interface AuditEntry {
  timestamp: string;
  tool: string;
  actor: string;
  result: "success" | "error";
  documentRef?: string;
  error?: string;
}

export type AuditFn = (entry: AuditEntry) => void | Promise<void>;

/**
 * A JSONL file sink: append one line per audit entry. Non-fatal — a failed
 * write never breaks a tool call. Node-only (uses `node:fs/promises`); pass any
 * other {@link AuditFn} (e.g. a DB writer) where a file sink doesn't fit.
 */
export function createJsonlAudit(filePath: string): AuditFn {
  return async (entry: AuditEntry) => {
    try {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      /* audit is best-effort */
    }
  };
}
