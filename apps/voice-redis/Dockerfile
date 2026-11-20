# F104.9.1 — Redis for broberg-voice (LiveKit) and broberg-voice-egress.
# base-image exception: Redis's own server image (vendor binary), not a Node/Bun app
FROM redis:7.4-alpine
COPY entrypoint.sh /broberg-entrypoint.sh
# F116 — Redis only needs /tmp (the config is written there) and port 6379; the image ships a non-root `redis` user.
USER redis
ENTRYPOINT ["/bin/sh", "/broberg-entrypoint.sh"]
