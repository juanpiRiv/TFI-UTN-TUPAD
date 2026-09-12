#!/usr/bin/env bash
# Crea el Project Board del equipo. Correr UNA SOLA VEZ (lo hace quien
# tenga el scope 'project' primero) y despues commitear project.env para
# que todo el equipo apunte al mismo board.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_gh
require_project_scope

if [ -n "${PROJECT_NUMBER:-}" ]; then
  echo "Ya existe scripts/github/project.env con PROJECT_NUMBER=${PROJECT_NUMBER}."
  echo "No creo un board nuevo. Si hace falta recrearlo, borra ese archivo a mano."
  exit 0
fi

echo "Creando el project board..."
PROJECT_JSON=$(gh project create --owner "$OWNER" --title "$REPO" --format json)
PROJECT_NUMBER=$(echo "$PROJECT_JSON" | jq -r '.number')
PROJECT_URL=$(echo "$PROJECT_JSON" | jq -r '.url')

cat > "${SCRIPT_DIR}/project.env" <<EOF
PROJECT_NUMBER=${PROJECT_NUMBER}
EOF

echo ""
echo "Board creado: ${PROJECT_URL}"
echo ""
echo "PASO MANUAL (una sola vez): entra al board -> Settings del campo"
echo "'Status' y dejalo con estas 6 opciones, en este orden:"
echo "  Backlog, To Do, In Progress, Review, Testing, Done"
echo ""
echo "Despues, commitea scripts/github/project.env para que Rios y Riveros"
echo "Valganon usen el mismo board (no crear uno nuevo cada uno)."
