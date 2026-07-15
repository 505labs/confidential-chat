# Multi-stage build for the Confidential Chat custom frontend.
# node:22-slim (glibc) so better-sqlite3 uses its prebuilt binary — no compile toolchain needed.

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

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Chats DB lives on a mounted volume so history survives redeploys.
ENV DB_PATH=/data/app.db
RUN useradd -m nextjs && mkdir -p /data && chown nextjs:nextjs /data
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
# Native module isn't traced into standalone reliably — copy it explicitly.
COPY --from=builder --chown=nextjs:nextjs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nextjs /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=nextjs:nextjs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
ARG GIT_SHA=dev
ARG BUILD_TIME=unknown
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME
USER nextjs
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
