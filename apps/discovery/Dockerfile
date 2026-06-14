# discovery.broberg.ai — Bun + Hono. Build context = repo root, so the image
# keeps the /app/scripts + /app/docs layout server.ts imports from (single source).
FROM oven/bun:1
WORKDIR /app

# Single source of truth (shared with the dashboard generator) + landing page.
COPY scripts/inventory-data.mjs ./scripts/inventory-data.mjs
COPY docs/inventory.html ./docs/inventory.html

# App deps.
COPY apps/discovery/package.json ./apps/discovery/package.json
WORKDIR /app/apps/discovery
RUN bun install

# App source.
COPY apps/discovery/server.ts ./server.ts

ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", "server.ts"]
