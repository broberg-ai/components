#!/usr/bin/env bash
# F090 — prove the gate has teeth BEFORE trusting its "no leaks".
#
#   secret-gate/selftest.sh <gitleaks-binary> <config>
#
# Generates a fake GitHub PAT, Discord + Slack webhook and one fake per fleet
# key format (F090.6) AT RUNTIME
# (nothing realistic is ever committed), scans them with <config>, and exits
# non-zero unless EVERY expected rule fires. A config that lost
# `useDefault = true` runs with zero built-in rules: the PAT and the Slack
# webhook go unfound and this fails — the exact failure that hid a Discord
# webhook in cms for six months while the scan reported clean.
set -euo pipefail
GITLEAKS="${1:?usage: selftest.sh <gitleaks> <config>}"
CONFIG="${2:?usage: selftest.sh <gitleaks> <config>}"
EXPECTED=(github-pat discord-webhook-url slack-webhook-url
  fleet-trail-key fleet-cardmem-key fleet-piw-key fleet-upmetrics-key
  fleet-cloudflare-user-token fleet-fly-token fleet-apikey-prefixed
  fleet-bearer-token fleet-labeled-token-param)

# `|| true`: head closing the pipe SIGPIPEs tr, which pipefail would report.
rand() { LC_ALL=C tr -dc "$1" </dev/urandom | head -c "$2" || true; }
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

# Split literals so this script itself never contains a matchable secret.
{
  echo "token = \"ghp""_$(rand 'A-Za-z0-9' 36)\""
  echo "hook = \"https://discord.com/api/web""hooks/$(rand '0-9' 19)/$(rand 'A-Za-z0-9_-' 68)\""
  echo "slack = \"https://hooks.slack.com/serv""ices/T$(rand 'A-Z0-9' 10)/B$(rand 'A-Z0-9' 10)/$(rand 'A-Za-z0-9' 24)\""
  # F090.6 — the fleet's own formats, one planted fake per rule.
  echo "trail = \"tra""il_$(rand 'A-Za-z0-9' 32)\""
  echo "cardmem = \"p""a_$(rand 'A-Za-z0-9' 32)\""
  echo "piw = \"pi""w_$(rand '0-9a-f' 64)\""
  echo "upmetrics = \"u""k_$(rand '0-9a-f' 48)\""
  echo "cf = \"cf""ut_$(rand 'A-Za-z0-9' 48)\""
  echo "fly = \"FlyV1 fm""2_$(rand 'A-Za-z0-9' 40)\""
  echo "apikey = \"wh""k_$(rand '0-9a-f' 64)\""
  echo "Authorization: Bea""rer A1$(rand 'A-Za-z0-9' 38)"
  echo "url = \"https://x.example/hook?tok""en=Z9$(rand 'A-Za-z0-9' 30)\""
} >"$dir/fakes.txt"

report="$dir/report.json"
"$GITLEAKS" dir "$dir/fakes.txt" --config "$CONFIG" --no-banner --redact \
  --report-format json --report-path "$report" --exit-code 0 >/dev/null 2>&1

missing=0
for rule in "${EXPECTED[@]}"; do
  if grep -q "\"RuleID\": *\"$rule\"" "$report"; then
    echo "  ok   $rule fires"
  else
    echo "  FAIL $rule did NOT fire on a planted fake"
    missing=$((missing + 1))
  fi
done

if [ "$missing" -gt 0 ]; then
  echo "::error::secret gate self-test: $missing of ${#EXPECTED[@]} planted fakes went unfound — the config is not scanning with the rules it claims (lost [extend] useDefault = true?). Refusing to report this repo clean."
  exit 1
fi
echo "self-test: all ${#EXPECTED[@]} planted fakes found — the gate has teeth."
