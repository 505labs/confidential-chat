# Multi-stage build for the Confidential Chat custom frontend.
# node:22-slim (glibc) so better-sqlite3 / onnxruntime-node / @napi-rs/canvas use
# their prebuilt binaries — no compile toolchain needed.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time provenance — surfaced in the UI footer / per-message badge.
ARG GIT_SHA=dev
ARG BUILD_TIME=unknown
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production-only dependency closure. next's `standalone` output traces the JS it
# bundles, but our native / asset-bearing packages are marked external
# (serverExternalPackages) and are require()'d at runtime — so they must exist in
# node_modules whole, WITH their transitive deps and per-platform binaries. A
# clean `npm ci --omit=dev` resolves exactly that closure deterministically,
# which is far more robust than copying packages one by one.
FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Chats DB + model/OCR caches live on a mounted volume so they survive redeploys.
ENV DB_PATH=/data/app.db
RUN useradd -m nextjs && mkdir -p /data && chown nextjs:nextjs /data
# 1) Full production node_modules (native modules + external packages resolve here).
COPY --from=prod-deps --chown=nextjs:nextjs /app/node_modules ./node_modules
# 2) Next.js standalone server + its traced files overlay on top (its own bundled
#    node_modules subset merges with the closure above; server.js sits at root).
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
ARG GIT_SHA=dev
ARG BUILD_TIME=unknown
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME
USER nextjs
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
