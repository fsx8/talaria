# Talaria — the sidecar + SPA in one image.
#
# Stage 1 builds the SPA (vue-tsc + vite) and the sidecar's production
# dependencies. Both outputs are pure JS — architecture-independent — so
# the build stage is pinned to the builder's platform ($BUILDPLATFORM)
# and multi-arch manifests (amd64 + arm64) cost no emulation. Stage 2 is
# per-architecture and only copies files.
#
# Built and published by .github/workflows/docker.yml on every push to
# main: ghcr.io/fsx8/talaria.
#
# The container shares Thunderbird's network namespace in deployment (see
# sidecar/compose.example.yaml) so the commonpost addon stays loopback-only
# and COMMONPOST_MCP_TOKEN never crosses a network. Push subscriptions
# persist in /app/data — mount a volume there.

# ---- build: SPA + sidecar prod deps (native platform, never emulated) ----
FROM --platform=$BUILDPLATFORM node:22-bookworm AS build
WORKDIR /app
COPY spa/package.json spa/package-lock.json spa/
RUN cd spa && npm ci --no-fund --no-audit
COPY spa/ spa/
# npm run build = vue-tsc --noEmit && vite build → ../sidecar/public
RUN cd spa && npm run build
COPY sidecar/package.json sidecar/package-lock.json sidecar/
RUN cd sidecar && npm ci --omit=dev --no-fund --no-audit

# ---- runtime: per-arch, no RUN steps (nothing to emulate) ----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    TALARIA_PUBLIC_DIR=/app/public
COPY --from=build /app/sidecar/node_modules ./node_modules
COPY sidecar/src ./src
COPY --from=build /app/sidecar/public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8942
CMD ["node", "src/index.js"]
