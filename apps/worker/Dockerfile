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
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
