#!/usr/bin/env bash
# F090 — prove the gate has teeth BEFORE trusting its "no leaks".
#
#   secret-gate/selftest.sh <gitleaks-binary> <config>
#
# Generates a fake GitHub PAT, Discord webhook and Slack webhook AT RUNTIME
# (nothing realistic is ever committed), scans them with <config>, and exits
# non-zero unless EVERY expected rule fires. A config that lost
# `useDefault = true` runs with zero built-in rules: the PAT and the Slack
# webhook go unfound and this fails — the exact failure that hid a Discord
# webhook in cms for six months while the scan reported clean.
set -euo pipefail
GITLEAKS="${1:?usage: selftest.sh <gitleaks> <config>}"
CONFIG="${2:?usage: selftest.sh <gitleaks> <config>}"
EXPECTED=(github-pat discord-webhook-url slack-webhook-url)

# `|| true`: head closing the pipe SIGPIPEs tr, which pipefail would report.
rand() { LC_ALL=C tr -dc "$1" </dev/urandom | head -c "$2" || true; }
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

# Split literals so this script itself never contains a matchable secret.
{
  echo "token = \"ghp""_$(rand 'A-Za-z0-9' 36)\""
  echo "hook = \"https://discord.com/api/web""hooks/$(rand '0-9' 19)/$(rand 'A-Za-z0-9_-' 68)\""
  echo "slack = \"https://hooks.slack.com/serv""ices/T$(rand 'A-Z0-9' 10)/B$(rand 'A-Z0-9' 10)/$(rand 'A-Za-z0-9' 24)\""
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
