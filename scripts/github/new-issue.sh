#!/usr/bin/env bash
# Crea un issue con el titulo y la label correctos (ver docs/CONTRIBUTING.md).
#
# Uso: ./new-issue.sh <type> <scope> "<descripcion>" <label> [archivo-body.md]
# Ejemplo: ./new-issue.sh feat clients "alta y baja logica de clientes" enhancement
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"

usage() {
  echo "Uso: $0 <type> <scope> \"<descripcion>\" <label> [archivo-body.md]" >&2
  echo "type sugerido: feat | fix | docs | chore" >&2
  exit 1
}

[ "$#" -lt 4 ] && usage

TYPE="$1"
SCOPE="$2"
DESC="$3"
LABEL="$4"
BODY_FILE="${5:-}"

require_gh

if ! gh label list --repo "$REPO_FULL" --json name --jq '.[].name' | grep -qxF "$LABEL"; then
  echo "La label '$LABEL' no existe en $REPO_FULL. Labels disponibles:" >&2
  gh label list --repo "$REPO_FULL" --json name --jq '.[].name' >&2
  exit 1
fi

TITLE="${TYPE}(${SCOPE}): ${DESC}"

echo "Buscando issues parecidos antes de crear uno nuevo..."
gh issue list --repo "$REPO_FULL" --search "$DESC" --limit 5 || true

read -r -p "Crear el issue \"$TITLE\"? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Cancelado."; exit 0; }

if [ -n "$BODY_FILE" ]; then
  URL=$(gh issue create --repo "$REPO_FULL" --title "$TITLE" --label "$LABEL" --body-file "$BODY_FILE")
else
  URL=$(gh issue create --repo "$REPO_FULL" --title "$TITLE" --label "$LABEL" --body "Sin descripcion detallada todavia.")
fi

echo "Issue creado: $URL"
NUMBER="${URL##*/}"
echo "Para agregarlo al board: ./scripts/github/add-to-board.sh ${NUMBER} \"To Do\""
