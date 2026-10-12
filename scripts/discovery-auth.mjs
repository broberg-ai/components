// F038.26 — how a CI job logs in to Discovery: a BrobergID ticket (GitHub OIDC →
// BID token exchange, WIF). No stored key: the DISCOVERY_SESSION/DISCOVERY_KEY
// secrets were removed once the ticket door was proven on main (run 38188055695).
// Returns the door used so the log can say which one, never the credential.

/**
 * @param {{ env: Record<string, string | undefined>, getTicket?: () => Promise<string> }} deps
 * @returns {Promise<{ door: "ticket" | "none", init: RequestInit, note?: string }>}
 */
export async function discoveryAuth({ env, getTicket }) {
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !getTicket) return { door: "none", init: {}, note: "no OIDC token in this job" };
  try {
    return { door: "ticket", init: { headers: { authorization: `Bearer ${await getTicket()}` } } };
  } catch (err) {
    return { door: "none", init: {}, note: `ticket refused: ${err instanceof Error ? err.message : String(err)}` };
  }
}
