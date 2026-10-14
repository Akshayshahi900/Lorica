# Build from repo root:
#   docker build -f apps/worker/Dockerfile .
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker ./apps/worker
COPY packages ./packages

RUN pnpm install --frozen-lockfile --filter @lorica/worker...

# prisma generate reads DATABASE_URL from packages/db config
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lorica"
RUN pnpm --filter @lorica/db exec prisma generate

ENV NODE_ENV=production
EXPOSE 10000

WORKDIR /app/apps/worker
# Bring the database schema up to this code before serving. Prisma holds an
# advisory lock, so the API and worker can both run this safely; a failed
# migration stops the container instead of running against a stale schema.
CMD ["sh", "-c", "pnpm --filter @lorica/db exec prisma migrate deploy && exec pnpm exec tsx src/index.ts"]
