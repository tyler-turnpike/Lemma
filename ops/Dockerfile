# Lemma hosted service: compiled server + static dashboard in one long-lived Node process.
# Build from the monorepo root:  docker build -f ops/Dockerfile .
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json tsconfig.base.json ./

RUN npm ci
# Compile only what the hosted service ships (server + its workspace deps, web), then bundle the
# dashboard. The root build also covers scripts/ and the bridge, which the image does not include.
RUN npx tsc -b apps/server apps/web && npm run bundle -w @lemma/web
RUN test -f apps/web/dist/index.html && test -f apps/server/dist/index.js
RUN npm prune --omit=dev
# No production source maps or declaration maps in the image.
RUN find apps packages -type f \( -name '*.map' -o -name '*.tsbuildinfo' \) -not -path '*/node_modules/*' -delete

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/migrations ./apps/server/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Applies pending migrations (advisory-locked, idempotent) when DATABASE_URL is set, then serves.
CMD ["node", "apps/server/dist/index.js"]
