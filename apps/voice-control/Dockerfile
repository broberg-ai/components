# F104.9.3 — broberg-voice-control. Bun, zero dependencies.
FROM oven/bun:1-slim
WORKDIR /app
COPY apps/voice-control/control.ts apps/voice-control/server.ts ./
ENV PORT=8080
# F116 — never run as root: the bun image ships a non-root `bun` user (uid 1000); nothing here writes outside /tmp.
USER bun
EXPOSE 8080
CMD ["bun", "run", "server.ts"]
