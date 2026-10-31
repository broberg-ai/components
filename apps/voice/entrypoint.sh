#!/bin/sh
# Fly carries UDP only to a process bound to the machine's `fly-global-services`
# address — bound to 0.0.0.0, replies leave from the wrong source address and
# every call fails silently. The address differs per machine, so it is read at
# boot. LiveKit has TWO UDP bind paths and both need it: the ICE mux
# (rtc.ips.includes) and the embedded TURN server (turn.bind_addresses).
set -eu
FGS_IP=$(awk '/fly-global-services/ {print $1; exit}' /etc/hosts)
if [ -z "$FGS_IP" ]; then
  echo "entrypoint: no fly-global-services in /etc/hosts — UDP would fail silently, refusing to start" >&2
  exit 1
fi
: "${VOICE_PUBLIC_IP:?VOICE_PUBLIC_IP (the app's dedicated IPv4) must be set}"
: "${LIVEKIT_KEYS:?LIVEKIT_KEYS must be set as a Fly secret}"
: "${LIVEKIT_TURN_SECRET:?LIVEKIT_TURN_SECRET (shared with broberg-voice-turn) must be set as a Fly secret}"
sed -e "s/__FGS_IP__/$FGS_IP/g" -e "s/__PUBLIC_IP__/$VOICE_PUBLIC_IP/g" -e "s/__TURN_SECRET__/$LIVEKIT_TURN_SECRET/g" \
  /etc/livekit.template.yaml > /tmp/livekit.yaml
echo "entrypoint: UDP bound to fly-global-services $FGS_IP, advertising $VOICE_PUBLIC_IP"
exec /livekit-server --config /tmp/livekit.yaml
