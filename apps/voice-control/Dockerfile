# F104.9.3 — broberg-voice-control. Bun, zero dependencies.
FROM oven/bun:1-slim
WORKDIR /app
COPY apps/voice-control/control.ts apps/voice-control/server.ts ./
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", "server.ts"]
