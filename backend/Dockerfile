# Dockerfile del backend (API Express + Prisma + PostgreSQL).
#
# El contexto de build es la RAIZ del monorepo (hace falta el lockfile y
# los package.json de todos los paquetes del workspace de pnpm):
#
#   docker build -f backend/Dockerfile -t tfi-backend .
#
# Y para correrlo contra una base Postgres accesible:
#
#   docker run --rm -p 3000:3000 \
#     -e DATABASE_URL="postgresql://tfi:tfi@host.docker.internal:5433/tfi_finanzas" \
#     -e JWT_SECRET="<secreto de 32+ chars>" \
#     tfi-backend
#
# Al arrancar corre `prisma migrate deploy` y despues levanta la API.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ── Dependencias ────────────────────────────────────────────────────
FROM base AS deps
# Toolchain por si argon2 no encuentra binario precompilado (binario nativo)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# El lockfile tiene un importer por paquete: hacen falta los dos package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
# prisma generate corre en postinstall: necesita el schema y el config ya copiados
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/prisma.config.ts

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --filter backend --frozen-lockfile

# ── Build ───────────────────────────────────────────────────────────
FROM deps AS build
COPY backend ./backend
RUN pnpm --filter backend build

# ── Runtime ─────────────────────────────────────────────────────────
# Se copian los node_modules del workspace completos (incluye prisma CLI,
# que hace falta para `migrate deploy` al arrancar el contenedor).
FROM node:22-bookworm-slim AS runtime
# openssl: Prisma lo detecta al arrancar. ca-certificates: HTTPS a ARCA/BCRA
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend ./backend
WORKDIR /app/backend
USER node
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/server.js"]
