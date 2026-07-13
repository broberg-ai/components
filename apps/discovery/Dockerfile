# discovery.broberg.ai — Bun + Hono. Build context = repo root, so the image
# keeps the /app/scripts + /app/docs layout server.ts imports from (single source).
FROM oven/bun:1
WORKDIR /app

# Single source of truth + the generators that render every served surface from it.
COPY scripts/inventory-data.mjs ./scripts/inventory-data.mjs
COPY scripts/build-inventory.mjs ./scripts/build-inventory.mjs
COPY scripts/build-onboarding.mjs ./scripts/build-onboarding.mjs

# Generate the landing + onboarding surfaces AT BUILD TIME from the single source,
# so every deploy re-renders them — a committed snapshot can never go stale in prod.
# (docs/inventory.html, docs/onboarding.html, docs/llms.txt, docs/llms-full.txt)
RUN mkdir -p docs && bun scripts/build-inventory.mjs && bun scripts/build-onboarding.mjs

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
