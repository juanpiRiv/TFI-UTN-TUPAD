#!/usr/bin/env bash
# Levanta el entorno de desarrollo completo:
#   Postgres (docker) + API en http://localhost:3000 + web en http://localhost:5173
#
#   ./scripts/dev.sh
#
# Corre setup.sh primero (idempotente) y despues arranca backend y
# frontend en paralelo. Ctrl+C frena los dos; la base queda corriendo.
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/setup.sh

pnpm --parallel --filter backend --filter frontend dev
