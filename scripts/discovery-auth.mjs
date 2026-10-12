// F038.26 — how a CI job logs in to Discovery. A Broberg ID ticket first (GitHub
// OIDC → BID token exchange, no stored key, WIF), the two GitHub secrets only as
// a fallback until the ticket door is proven on main; then the fallback goes.
// Returns the door used so the log can say which one, never the credential.

/**
 * @param {{ env: Record<string, string | undefined>, getTicket?: () => Promise<string> }} deps
 * @returns {Promise<{ door: "ticket" | "key" | "none", init: RequestInit, note?: string }>}
 */
export async function discoveryAuth({ env, getTicket }) {
  let note;
  if (env.ACTIONS_ID_TOKEN_REQUEST_URL && getTicket) {
    try {
      return { door: "ticket", init: { headers: { authorization: `Bearer ${await getTicket()}` } } };
    } catch (err) {
      note = `ticket refused, falling back: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (env.DISCOVERY_SESSION && env.DISCOVERY_KEY) {
    return { door: "key", init: { headers: { "x-discovery-session": env.DISCOVERY_SESSION, "x-enroll-key": env.DISCOVERY_KEY } }, note };
  }
  return { door: "none", init: {}, note };
}
