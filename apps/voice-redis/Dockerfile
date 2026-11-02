# F104.9.1 — Redis for broberg-voice (LiveKit) and broberg-voice-egress.
# base-image exception: Redis's own server image (vendor binary), not a Node/Bun app
FROM redis:7.4-alpine
COPY entrypoint.sh /broberg-entrypoint.sh
ENTRYPOINT ["/bin/sh", "/broberg-entrypoint.sh"]
