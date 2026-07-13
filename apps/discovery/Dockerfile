# discovery.broberg.ai — Bun + Hono. Build context = repo root, so the image
# keeps the /app/scripts + /app/docs layout server.ts imports from (single source).
FROM oven/bun:1
WORKDIR /app

# Single source of truth (shared with the dashboard generator) + landing page.
COPY scripts/inventory-data.mjs ./scripts/inventory-data.mjs
COPY docs/inventory.html ./docs/inventory.html
COPY docs/onboarding.html ./docs/onboarding.html
COPY docs/llms.txt ./docs/llms.txt
COPY docs/llms-full.txt ./docs/llms-full.txt

# App deps.
COPY apps/discovery/package.json ./apps/discovery/package.json
WORKDIR /app/apps/discovery
RUN bun install

# App source.
COPY apps/discovery/server.ts ./server.ts
COPY apps/discovery/enroll.ts ./enroll.ts
COPY apps/discovery/speech-dictionary.ts ./speech-dictionary.ts

ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", "server.ts"]
