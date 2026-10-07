# Build from repo root:
#   docker build -f apps/api/Dockerfile .
FROM node:20-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api ./apps/api
COPY packages ./packages

RUN pnpm install --frozen-lockfile --filter api...

# prisma generate reads DATABASE_URL from packages/db config
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lorica"
RUN pnpm --filter @lorica/db exec prisma generate

ENV NODE_ENV=production
EXPOSE 5000

WORKDIR /app/apps/api
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
