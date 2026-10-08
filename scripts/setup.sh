#!/usr/bin/env bash
# Prepara el entorno de desarrollo local. Idempotente: se puede correr
# cuantas veces sea, solo completa lo que falta.
#
#   ./scripts/setup.sh
#
# Hace, en orden:
#   1. Verifica requisitos (node >= 22, pnpm, docker corriendo)
#   2. pnpm install (genera el cliente de Prisma via postinstall)
#   3. Crea backend/.env y frontend/.env.local si no existen
#   4. Levanta Postgres con docker compose y espera a que responda
#   5. Corre las migraciones de Prisma
set -euo pipefail
cd "$(dirname "$0")/.."

# ── 1. Requisitos ────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || { echo "Falta node. Instalar con: nvm install"; exit 1; }
NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
[ "$NODE_MAJOR" -ge 22 ] || { echo "Se necesita Node >= 22.22 (hay $(node -v)). Probar: nvm use"; exit 1; }

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm no encontrado, activandolo con corepack..."
  corepack enable && corepack prepare pnpm@10.33.0 --activate
fi

docker info >/dev/null 2>&1 || { echo "Docker no esta corriendo. Abrir Docker Desktop y reintentar."; exit 1; }

# ── 2. Dependencias ─────────────────────────────────────────────────
pnpm install

# ── 3. Variables de entorno ─────────────────────────────────────────
if [ ! -f backend/.env ]; then
  cp backend/.env-template backend/.env
  JWT=$(openssl rand -hex 32)
  sed -i.bak "s/^JWT_SECRET=.*/JWT_SECRET=${JWT}/" backend/.env && rm backend/.env.bak
  echo "backend/.env creado (JWT_SECRET generado automaticamente)"
fi

if [ ! -f frontend/.env.local ]; then
  printf 'VITE_API_URL=http://localhost:3000\nVITE_USE_MOCKS=true\n' > frontend/.env.local
  echo "frontend/.env.local creado (mocks MSW prendidos)"
fi

# ── 4. Base de datos ────────────────────────────────────────────────
docker compose -f backend/docker-compose.yml up -d --wait

# ── 5. Migraciones ──────────────────────────────────────────────────
(cd backend && pnpm exec prisma migrate deploy)

echo ""
echo "Listo. Para levantar backend + frontend juntos: ./scripts/dev.sh"
