# Talaria — the sidecar + SPA in one image.
#
# Stage 1 builds the SPA (vue-tsc + vite) straight into the sidecar's
# static dir; stage 2 ships the sidecar with production dependencies only.
# Built and published by .github/workflows/docker.yml on every push to
# main: ghcr.io/fsx8/talaria.
#
# The container shares Thunderbird's network namespace in deployment (see
# sidecar/compose.example.yaml) so the commonpost addon stays loopback-only
# and COMMONPOST_MCP_TOKEN never crosses a network. Push subscriptions
# persist in /app/data — mount a volume there.

# ---- SPA build (typecheck included: npm run build = vue-tsc && vite build) ----
FROM node:22-bookworm AS spa-build
WORKDIR /build/spa
COPY spa/package.json spa/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY spa/ ./
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    TALARIA_PUBLIC_DIR=/app/public
COPY sidecar/package.json sidecar/package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY sidecar/src ./src
COPY --from=spa-build /build/sidecar/public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8942
CMD ["node", "src/index.js"]
