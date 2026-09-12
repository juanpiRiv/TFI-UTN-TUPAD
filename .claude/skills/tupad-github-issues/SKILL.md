---
name: tupad-github-issues
description: "Trigger: filing/creating a GitHub issue (bug, feature, chore, or backlog item from the requirements catalog) in juanpiRiv/TFI-UTN-TUPAD; or opening the PR that implements one. Wires title, label, project board Status, and the PR-to-issue link needed to move work across the project's Backlog/To Do/In Progress/Review/Testing/Done board."
license: Apache-2.0
metadata:
  author: juanpiRiv
  version: "1.0"
allowed-tools: Bash(gh:*), Read
---

## Activation Contract

Load before running `gh issue create` (or equivalent) against
`juanpiRiv/TFI-UTN-TUPAD` — bug, feature, chore, or a backlog item derived
from the requirements catalog (`docs/TFI_Primera_Entrega.pdf`, sections 13-15:
RF-*, RNF-*, RN-*). Also load when opening the PR that implements an issue
tracked by this skill, and when creating or configuring the project board
itself (it doesn't exist yet as of the first entrega — see Hard Rule 4).

## Hard Rules

1. **This is a personal repo, not an organization.** Org-level Issue Types
   and native Issue Fields (Priority/Effort as first-class sidebar fields)
   do not exist here — `gh api graphql` querying `issueTypes` on this repo
   returns `null`. Never invent `updateIssueIssueType` or
   `setIssueFieldValue` mutations for this repo; that pattern belongs to a
   different kind of repo entirely. If Priority/Effort tracking is wanted,
   it must be a plain label (created explicitly, see Rule 3) or a
   ProjectV2 custom field on the board itself.
2. **`gh project` commands need a scope this token doesn't have yet.**
   `gh project list --owner juanpiRiv` and any `projectsV2` GraphQL query
   fail with `INSUFFICIENT_SCOPES` until the user runs
   `gh auth refresh -s project -s read:project` (interactive — requires the
   user, never run it for them). Check this in the same turn before any
   board mutation; if it still fails, stop and tell the user to run that
   refresh instead of working around it.
3. **Only the real label set exists right now**: `accessibility`, `bug`,
   `documentation`, `duplicate`, `enhancement`, `good first issue`,
   `help wanted`, `invalid`, `question`, `wontfix` (verify with
   `gh label list --repo juanpiRiv/TFI-UTN-TUPAD` — it can change). No
   `chore`, `priority:*`, `dependencies`, or `security-fix` label exists.
   Classify into what's actually there (see mapping table in
   `references/conventions-and-board.md`); if a new label is genuinely
   needed, create it explicitly with `gh label create --repo
   juanpiRiv/TFI-UTN-TUPAD` as a deliberate, visible step — never assume it
   exists.
4. **The project board doesn't exist yet.** The accepted proposal
   (`docs/TFI_Primera_Entrega.pdf`, section 16) specifies a Kanban board
   with exactly six Status columns: `Backlog`, `To Do`, `In Progress`,
   `Review`, `Testing`, `Done`. When creating the board or its Status field
   for the first time, use these six options in this order — not GitHub's
   3-column default. Once created, treat its field/option IDs the same way
   as Rule 5: discover, never hardcode.
5. **Node/field/option IDs are never known in advance here.** Unlike a
   mature repo with a stable board, this project's board and its field IDs
   will be created fresh by this skill's own steps. Before any mutation
   that needs an ID (issue node id, project id, field id, option id), run
   the matching query in the same turn and use what it returns — never
   copy an ID from a previous session into a new one.
6. **Closing keywords (`Closes #<n>`) only fire on merge to the repo's
   default branch**, which is `main` here. The branch strategy from the
   proposal (section 16) is `main` (stable) ← `develop` (integration) ←
   `feature/*`/`fix/*`. A `feature/*` → `develop` PR will NOT auto-close
   the issue or move the board to Done no matter what its body says — use
   `Refs #<n>` there instead, and reserve `Closes #<n>` for whichever PR
   actually merges into `main` (a release PR from `develop`, or a direct
   `fix/*` → `main` hotfix). Don't hand-move Status to Done on a
   `develop`-only merge just because the feature is finished.
7. **The requirements catalog is the backlog's source of truth**, not
   ad-hoc invention. `docs/TFI_Primera_Entrega.pdf` sections 13-15 list
   RF-01..34 (functional), RNF-01..12 (non-functional), RN-01..14 (business
   rules), grouped by module (Usuarios, Organización, Clientes, Finanzas,
   BCRA/Cotizaciones, Facturación, Pagos y Dashboard) and by backend module
   (Authentication, Users, Organizations, Clients, Categories,
   Transactions, Dashboard, ExchangeRates, Invoices, Payments,
   ARCA Integration, BCRA Integration, Notifications, Reports, Audit — see
   `references/conventions-and-board.md`). When seeding the initial
   backlog, file **one issue per module/feature slice**, referencing the
   RF/RN/RNF codes it covers in the body — never one issue per single RF
   line; that turns the board into unmanageable noise.

## Decision Gates

See `references/conventions-and-board.md` for the label mapping table,
title convention, the module → scope table (used for the `(<scope>)` part
of the title), and the board-creation GraphQL. Classify each issue on what
it actually is — a broken thing is `bug`, a docs-only change is
`documentation`, everything else building toward the MVP is `enhancement`.

## Execution Steps

1. Confirm prerequisites: `gh auth status`, then
   `gh label list --repo juanpiRiv/TFI-UTN-TUPAD` (real label set — Rule 3),
   then `gh project list --owner juanpiRiv` (Rule 2 — stop and ask the user
   to refresh scope if this errors).
2. Search duplicates: `gh issue list --repo juanpiRiv/TFI-UTN-TUPAD --search
   "<keywords>"`.
3. Classify against `references/conventions-and-board.md`'s mapping table
   and confirm the label is in the real set from step 1.
4. Create the issue:
   ```bash
   gh issue create --repo juanpiRiv/TFI-UTN-TUPAD \
     --title "<type>(<scope>): <description>" --label "<label>" \
     --body "$(cat <<'EOF'
   <body — reference the RF-/RNF-/RN- codes this covers>
   EOF
   )"
   ```
5. If the project board doesn't exist yet, create it and its six-option
   Status field per `references/conventions-and-board.md`'s board-setup
   section (run once, not per issue).
6. Add the issue to the board and set Status via `gh project item-add` /
   `item-edit`, using field/option IDs discovered fresh this turn
   (Rule 5). New issues may already auto-add if a workflow is later
   configured — verify with `gh project item-list` before adding manually
   to avoid a duplicate item.
7. When the PR implementing this issue is opened, pick the closing keyword
   per Rule 6 based on its target branch (`develop` → `Refs #<n>`; the PR
   that lands on `main` → `Closes #<n>`).

## Output Contract

Report the issue URL plus a checklist of what was set: label, board added
(yes/no), Status column, and which RF/RNF/RN codes it covers. If a PR for
this issue is being opened in the same session, state its target branch and
confirm the correct keyword (`Refs` vs `Closes`) is in its body per Rule 6.

## References

- `references/conventions-and-board.md` — real label mapping table, title
  convention, module → scope table from the requirements catalog, and the
  GraphQL to create the board and its six-column Status field the first
  time.
