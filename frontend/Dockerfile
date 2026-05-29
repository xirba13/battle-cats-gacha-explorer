# pnpm 11 requires Node >= 22.13 (it uses the node:sqlite builtin), so use Node 22.
FROM node:22-alpine

WORKDIR /app
RUN corepack enable

# Copy manifests first for layer caching; the committed lockfile pins versions
# and pnpm-workspace.yaml carries the esbuild build-script allowlist.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 5173
# Dev server with the API proxied to the backend service (see docker-compose).
CMD ["pnpm", "dev", "--host", "0.0.0.0"]
