# Build from repo root:
#   docker build -f apps/web/Dockerfile .
FROM node:20-bookworm-slim AS base

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter web...

FROM base AS builder

COPY --from=deps /app ./
COPY apps/web ./apps/web

# next.config.js requires these at build time
ARG GITHUB_ID=build
ARG GITHUB_SECRET=build
ARG NEXTAUTH_URL=http://localhost:3001
ARG NEXTAUTH_SECRET=build-secret
ARG LORICA_API_URL=http://localhost:5000
ARG LORICA_API_TOKEN=build-token
ARG NEXT_PUBLIC_GITHUB_APP_NAME=lorica

ENV GITHUB_ID=$GITHUB_ID \
    GITHUB_SECRET=$GITHUB_SECRET \
    NEXTAUTH_URL=$NEXTAUTH_URL \
    NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
    LORICA_API_URL=$LORICA_API_URL \
    LORICA_API_TOKEN=$LORICA_API_TOKEN \
    NEXT_PUBLIC_GITHUB_APP_NAME=$NEXT_PUBLIC_GITHUB_APP_NAME \
    NODE_ENV=production

RUN pnpm --filter web build

FROM base AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/web ./apps/web
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3001

WORKDIR /app/apps/web
CMD ["pnpm", "start"]
