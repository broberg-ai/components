# F104.9.6 — call-demo (owner's test page for @broberg/call + recording). Built from the repo root.
FROM oven/bun:1-slim
WORKDIR /app
COPY packages/call/package.json packages/call/
RUN cd packages/call && bun install --production
COPY packages/call/src packages/call/src
# F104.9.7 — recordings are listed and signed through @broberg/media (imported from source).
COPY packages/media/package.json packages/media/
RUN cd packages/media && bun install --production
COPY packages/media/src packages/media/src
COPY apps/call-demo/package.json apps/call-demo/
RUN cd apps/call-demo && bun install --production
COPY apps/call-demo/server.ts apps/call-demo/page.ts apps/call-demo/
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", "apps/call-demo/server.ts"]
