#!/usr/bin/env bash
# Regenerate docs/inventory.html and sync it to the hosted cardmem mockup.
#
# The mockup at cardmem.com/mockups/<MOCKUP_ID> is a hosted MIRROR of the
# generated inventory page — it does NOT auto-update. Run this after any change
# to scripts/build-inventory.mjs (the DATA array) so the shareable mockup never
# goes stale.
#
# Token-frugal by design: the HTML is piped FILE -> jq -> curl straight to the
# cardmem MCP endpoint, so the ~75KB payload never passes through a cc session's
# context (≈0 tokens on the body, and zero hand-transcription risk).
#
# Usage:  bash scripts/sync-mockup.sh ["changelog message"]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- config: this repo's cardmem project + the inventory mockup it owns ---
PROJECT_ID="019ea70e-0c53-7a40-8ce6-81a3b0f52bc0"
MOCKUP_ID="019eae3c-0727-7908-992f-67a0e50ad4ed"
TITLE="Component Universe — inventory dashboard"
HTML_FILE="docs/inventory.html"
CHANGELOG="${1:-Re-synced inventory dashboard from scripts/build-inventory.mjs}"

command -v jq   >/dev/null || { echo "✗ jq not found";   exit 1; }
command -v curl >/dev/null || { echo "✗ curl not found"; exit 1; }

# 1. Regenerate the page from the single source of truth (the DATA array).
echo "▶ regenerating $HTML_FILE …"
node scripts/build-inventory.mjs

# 2. Read the cardmem MCP endpoint + key from .mcp.json (no secret inlined here).
TOKEN="$(jq -r '.mcpServers.cardmem.headers.Authorization' .mcp.json)"
URL="$(jq -r '.mcpServers.cardmem.url' .mcp.json)"
{ [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; } || { echo "✗ no cardmem Authorization in .mcp.json"; exit 1; }

# 3. Pipe the HTML FILE -> jq (safely JSON-encodes it) -> curl. The payload is
#    read straight off disk by jq --rawfile; it never enters a cc context.
echo "▶ syncing mockup $MOCKUP_ID …"
RESP="$(
  jq -n \
    --arg pid "$PROJECT_ID" \
    --arg mid "$MOCKUP_ID" \
    --arg title "$TITLE" \
    --arg log "$CHANGELOG" \
    --rawfile html "$HTML_FILE" \
    '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"cardmem_save_mockup",arguments:{project_id:$pid,mockup_id:$mid,source_type:"standalone",title:$title,html:$html,changelog:$log}}}' \
  | curl -sS -X POST "$URL" \
      -H "Authorization: $TOKEN" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      --data-binary @-
)"

# 4. Parse the (SSE-framed) JSON-RPC response and report the new version.
DATA="$(printf '%s\n' "$RESP" | sed -n 's/^data: //p' | tail -1)"
[ -n "$DATA" ] || DATA="$RESP"
TEXT="$(printf '%s' "$DATA" | jq -r '.result.content[0].text // empty' 2>/dev/null || true)"
if [ -z "$TEXT" ]; then
  echo "✗ save_mockup failed:"; printf '%s\n' "$RESP"; exit 1
fi
VERSION="$(printf '%s' "$TEXT" | jq -r '.version')"
echo "✅ mockup synced → v$VERSION  ·  https://cardmem.com/mockups/$MOCKUP_ID"
