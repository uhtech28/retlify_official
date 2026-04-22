# syntax=docker/dockerfile:1.6
# Multi-stage build for small final image

# ---- Dependencies stage ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000

COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend ./backend
COPY frontend ./frontend
COPY sitemap.xml robots.txt ./

RUN addgroup -S app && adduser -S app -G app \
    && chown -R app:app /app
USER app

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

WORKDIR /app/backend
CMD ["node", "cluster.js"]
