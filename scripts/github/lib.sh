#!/usr/bin/env bash
# Variables y chequeos compartidos por los scripts de scripts/github/.
# No se ejecuta solo: los demas scripts hacen `source lib.sh`.
set -euo pipefail

OWNER="juanpiRiv"
REPO="TFI-UTN-TUPAD"
REPO_FULL="${OWNER}/${REPO}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ENV="${SCRIPT_DIR}/project.env"

if [ -f "$PROJECT_ENV" ]; then
  # shellcheck source=/dev/null
  source "$PROJECT_ENV"
fi

require_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "Falta instalar GitHub CLI (gh). Ver https://cli.github.com/" >&2
    exit 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "Falta instalar jq." >&2
    exit 1
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "No estas logueado en gh. Corre: gh auth login" >&2
    exit 1
  fi
}

require_project_scope() {
  if ! gh project list --owner "$OWNER" >/dev/null 2>&1; then
    echo "Tu token de gh no tiene el scope 'project'. Corre:" >&2
    echo "  gh auth refresh -s project -s read:project" >&2
    exit 1
  fi
}
