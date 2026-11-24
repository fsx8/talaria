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
FROM --platform=$BUILDPLATFORM node:26-slim AS build
WORKDIR /app
# Both packages are pnpm-managed (version pinned by each packageManager
# field). Node 26 ships no corepack, so pnpm is installed directly.
RUN npm install -g --no-fund --no-audit pnpm@12.23.0
COPY spa/package.json spa/pnpm-lock.yaml spa/
RUN cd spa && pnpm install --frozen-lockfile
COPY spa/ spa/
# pnpm run build = vue-tsc --noEmit && vite build → ../sidecar/public
RUN cd spa && pnpm run build
# --prod keeps vite-plus (dev-only tooling) out of the image; pnpm's
# symlinked node_modules layout is fully relative, so the plain COPY into
# the runtime stage preserves it.
COPY sidecar/package.json sidecar/pnpm-lock.yaml sidecar/pnpm-workspace.yaml sidecar/
RUN cd sidecar && pnpm install --frozen-lockfile --prod

# ---- runtime: per-arch, no RUN steps (nothing to emulate) ----
FROM node:26-slim
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
