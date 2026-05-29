FROM node:20-alpine

WORKDIR /app
RUN corepack enable

COPY package.json ./
# No lockfile is committed; install resolves the ranges in package.json.
RUN pnpm install

COPY . .

EXPOSE 5173
# Dev server with the API proxied to the backend service (see docker-compose).
CMD ["pnpm", "dev", "--host", "0.0.0.0"]
