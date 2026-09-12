#!/usr/bin/env bash
# Agrega un issue existente al Project Board y le pone un Status.
#
# Uso: ./add-to-board.sh <numero-de-issue> "<Status>"
# Status validos: Backlog | "To Do" | "In Progress" | Review | Testing | Done
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"

if [ "$#" -lt 2 ]; then
  echo "Uso: $0 <numero-de-issue> \"<Status>\"" >&2
  exit 1
fi

ISSUE="$1"
STATUS="$2"

require_gh
require_project_scope

if [ -z "${PROJECT_NUMBER:-}" ]; then
  echo "Todavia no existe project.env. Corre primero: ./scripts/github/setup-board.sh" >&2
  exit 1
fi

if [[ "$ISSUE" =~ ^[0-9]+$ ]]; then
  ISSUE_URL=$(gh issue view "$ISSUE" --repo "$REPO_FULL" --json url --jq '.url')
else
  ISSUE_URL="$ISSUE"
fi

ITEM_JSON=$(gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$ISSUE_URL" --format json)
ITEM_ID=$(echo "$ITEM_JSON" | jq -r '.id')

FIELDS_JSON=$(gh api graphql -f query='
query($owner: String!, $number: Int!) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      fields(first: 20) {
        nodes { ... on ProjectV2SingleSelectField { id name options { id name } } }
      }
    }
  }
}' -f owner="$OWNER" -F number="$PROJECT_NUMBER")

PROJECT_ID=$(echo "$FIELDS_JSON" | jq -r '.data.user.projectV2.id')
STATUS_FIELD_ID=$(echo "$FIELDS_JSON" | jq -r '.data.user.projectV2.fields.nodes[] | select(.name=="Status") | .id')
STATUS_OPTION_ID=$(echo "$FIELDS_JSON" | jq -r --arg s "$STATUS" \
  '.data.user.projectV2.fields.nodes[] | select(.name=="Status") | .options[] | select(.name==$s) | .id')

if [ -z "$STATUS_OPTION_ID" ]; then
  echo "No encontre la opcion de Status '$STATUS'." >&2
  echo "Opciones disponibles:" >&2
  echo "$FIELDS_JSON" | jq -r '.data.user.projectV2.fields.nodes[] | select(.name=="Status") | .options[].name' >&2
  exit 1
fi

gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$STATUS_FIELD_ID" --single-select-option-id "$STATUS_OPTION_ID"

echo "Listo: issue agregado/actualizado en el board con Status = ${STATUS}"
