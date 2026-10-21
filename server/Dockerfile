# Build context: the REPO ROOT (the server imports ../shared and serves ../web/dist).
#   docker build -f server/Dockerfile -t latent-api .
# Layout inside the image mirrors the repo so relative paths resolve:
#   /app/server/dist/server/src/index.js   (compiled server)
#   /app/web/dist                          (built web app, served by the server)

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY server/package.json server/package-lock.json server/
COPY web/package.json web/package-lock.json web/
RUN npm --prefix server ci && npm --prefix web ci

COPY shared shared
COPY server server
COPY web web
RUN npm --prefix server run build && npm --prefix web run build

# Production-only server dependencies.
RUN npm --prefix server prune --omit=dev

# ---------- runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8787
WORKDIR /app/server

COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/web/dist /app/web/dist

# Runs as root on purpose: Fly mounts the /data volume root-owned, so a non-root user could not write to it.
RUN mkdir -p /data

EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "dist/server/src/index.js"]
