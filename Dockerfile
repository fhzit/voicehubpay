# syntax=docker/dockerfile:1
# VoiceHubPay API server image.
# Builds the web frontend, then installs/bundles the server workspace and
# runs it with tsx (no separate compile step — same entry as npm start).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
# Install the full workspace once (server deps include native builds).
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build the web frontend into apps/web/dist.
RUN npm run build --workspace @voicehubpay/web

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# tsx is a devDependency of the server workspace; install production deps
# plus tsx without dev tree.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN npm ci --omit=dev --workspace @voicehubpay/server --workspace @voicehubpay/contracts --workspace @voicehubpay/db \
    && npm install --no-save tsx@^4.19.4 \
    && npm cache clean --force

COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY apps/server ./apps/server
COPY packages ./packages

# Legacy PHP-parity layout: master key lives at /data/storage/.masterkey,
# SQLite at /data/database/voicehubpay.sqlite (override via env).
ENV APP_BASE_PATH=/data \
    DATABASE_PATH=/data/database/voicehubpay.sqlite \
    PORT=8080 \
    HOST=0.0.0.0
VOLUME ["/data"]
EXPOSE 8080

USER node
WORKDIR /app/apps/server
CMD ["npx", "tsx", "src/index.ts"]
