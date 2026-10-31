# legal.broberg.ai — components F110.5. Bun, zero dependencies; the library is
# copied from packages/legal so the endpoint serves exactly the package's text.
FROM oven/bun:1-slim
WORKDIR /app
COPY packages/legal/src ./packages/legal/src
COPY apps/legal/server.ts ./apps/legal/server.ts
WORKDIR /app/apps/legal
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", "server.ts"]
