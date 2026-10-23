# F104.5 — TURN over TLS on port 443 for voice.broberg.ai, so a call works from
# a network that only lets port 443 out. Fly terminates TLS on 443 and passes
# plain TCP to coturn; UDP 3478 + a small relay range are direct.
# base-image exception: coturn's own server image (vendor binary), not a Node/Bun app
FROM coturn/coturn:4.18.0-alpine
USER root
COPY entrypoint.sh /broberg-entrypoint.sh
ENTRYPOINT ["/bin/sh", "/broberg-entrypoint.sh"]
