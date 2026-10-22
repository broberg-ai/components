#!/bin/sh
# Fly carries UDP only to a process bound to the machine's `fly-global-services`
# address — bound to 0.0.0.0, replies leave from the wrong source address and
# relayed media fails silently (the same trap as apps/voice). The address
# differs per machine, so it is read at boot. coturn binds its listener AND its
# relay sockets to it; the dedicated IPv4 is what it tells clients.
set -eu
FGS_IP=$(awk '/fly-global-services/ {print $1; exit}' /etc/hosts)
if [ -z "$FGS_IP" ]; then
  echo "entrypoint: no fly-global-services in /etc/hosts — UDP would fail silently, refusing to start" >&2
  exit 1
fi
: "${TURN_PUBLIC_IP:?TURN_PUBLIC_IP (the app's dedicated IPv4) must be set}"
: "${TURN_SECRET:?TURN_SECRET must be set as a Fly secret}"
: "${TURN_REALM:?TURN_REALM must be set}"
echo "entrypoint: coturn on fly-global-services $FGS_IP, advertising $TURN_PUBLIC_IP"
# TCP (behind Fly's TLS on 443) arrives on the machine's normal interface, so
# the TCP listener is 0.0.0.0; UDP + relay are bound to fly-global-services.
exec turnserver \
  --listening-ip=0.0.0.0 --listening-ip="$FGS_IP" --listening-port=3478 \
  --relay-ip="$FGS_IP" --external-ip="$TURN_PUBLIC_IP/$FGS_IP" \
  --min-port=49160 --max-port=49200 \
  --use-auth-secret --static-auth-secret="$TURN_SECRET" --realm="$TURN_REALM" \
  --no-tls --fingerprint \
  --no-multicast-peers --denied-peer-ip=10.0.0.0-10.255.255.255 \
  --denied-peer-ip=172.16.0.0-172.31.255.255 --denied-peer-ip=192.168.0.0-192.168.255.255 \
  --total-quota=200 --user-quota=12 --log-file=stdout --simple-log
