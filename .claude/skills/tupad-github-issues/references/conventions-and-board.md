# Conventions and board setup — juanpiRiv/TFI-UTN-TUPAD

## Real label set (verify, don't guess)

```bash
gh label list --repo juanpiRiv/TFI-UTN-TUPAD
```
`accessibility`, `bug`, `documentation`, `duplicate`, `enhancement`,
`good first issue`, `help wanted`, `invalid`, `question`, `wontfix` — the
GitHub default set, untouched so far. No `chore`, `priority:*`,
`dependencies`, or `security-fix` label exists yet.

## Title convention

Conventional-commit style, matching the branch names from the proposal
(`feature/client-module`, `fix/...`): `<type>(<scope>): <description>`,
e.g. `feat(clients): alta y baja logica de clientes`,
`fix(arca): manejo de rechazo WSFEv1`,
`docs(readme): actualizar stack tecnologico`.

## Label ↔ Issue Type mapping

No org Issue Types exist here (Hard Rule 1), so "Issue Type" below is
informal — it only shapes the title's `<type>` prefix, not a GraphQL field.

| Situation | Label | Title `<type>` |
| --- | --- | --- |
| Bug / broken behavior / incorrect data | `bug` | `fix` |
| New module, endpoint, screen, or capability toward the MVP | `enhancement` | `feat` |
| Chore, refactor, tooling, CI, repo housekeeping | `enhancement` (no `chore` label exists) | `chore` |
| Docs-only change (README, docs/, skill) | `documentation` | `docs` |
| Accessibility-specific fix or requirement | `accessibility` (+ `bug` if it's broken, `enhancement` if new) | `fix` or `feat` |

**Triage-only labels — never set at creation time**: `question`, `invalid`,
`wontfix`, `duplicate` (a maintainer applies these when reviewing).

## Module → scope table (for the `(<scope>)` part of the title)

From `docs/TFI_Primera_Entrega.pdf` sections 11 and 13-15. Use the backend
module name (lowercase) as the scope; frontend-only work can use the same
scope with a `frontend` sub-note in the body if needed — don't split one
feature into two issues just because it touches both layers.

| Module (backend) | Covers (RF codes) |
| --- | --- |
| `auth` | Authentication — RF-01, RF-02, RF-03 |
| `users` | User profile — RF-04 |
| `organizations` | Org/business data, base currency — RF-05, RF-06 |
| `clients` | Client CRUD, search, history — RF-07..RF-11 |
| `categories` | Movement categorization — RF-14 |
| `transactions` | Income/expense registration, filters — RF-12, RF-13, RF-15, RF-16, RF-17 |
| `dashboard` | Period totals, gestión/caja result, charts — RF-31..RF-34 |
| `exchange-rates` | BCRA quote consumption/cache — RF-18..RF-21 |
| `invoices` | Invoice creation, totals, PDF — RF-22, RF-23, RF-27, RF-28 |
| `arca` | WSFEv1 integration, CAE, authorization result — RF-24, RF-25, RF-26 |
| `payments` | Payment registration, balance, facturado vs cobrado — RF-29, RF-30, RF-33 |
| `notifications` | Kapso/WhatsApp (evolutivo, post-MVP) | — |
| `reports` | Period reports | — |
| `audit` | Event trazability — RNF-08 | — |

Non-functional requirements (RNF-01..12) and business rules (RN-01..14)
usually belong inside the issue of the module they constrain (e.g. RN-07
"a factura must contain at least one item" goes in the `invoices` issue),
not as their own standalone issues — reference the codes in the body's
acceptance criteria instead of filing them separately.

## Board setup (run once — the project doesn't exist yet)

Prerequisite: `gh auth refresh -s project -s read:project` (interactive,
the user runs this, not this skill).

```bash
# 1. Create the project (owner = the user, since this is a personal repo)
gh project create --owner juanpiRiv --title "TFI-UTN-TUPAD"
# capture the returned project number/id

# 2. Link it to the repo (optional but keeps it discoverable from the repo UI)
gh project link <number> --owner juanpiRiv --repo juanpiRiv/TFI-UTN-TUPAD

# 3. Discover the built-in Status field id (every ProjectV2 board ships one)
gh api graphql -f query='
{ user(login: "juanpiRiv") { projectV2(number: <number>) {
  id
  fields(first: 20) { nodes {
    ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }'
```

The default Status field ships with `Todo`/`In Progress`/`Done`. Replace
its options with the six from the proposal — `Backlog`, `To Do`,
`In Progress`, `Review`, `Testing`, `Done` — via the project's Settings UI
(GraphQL option editing on an existing field is not exposed the same way
`gh project field-create` handles new fields; the UI is the reliable path
for editing an existing single-select field's options). After editing,
re-run the discovery query above in the same turn to get the six new
option ids before using any of them in `item-edit` — never reuse an option
id from before the edit.

Adding an item and setting its Status once ids are known:
```bash
gh project item-add <number> --owner juanpiRiv --url <issue-url> --format json   # → .id
gh project item-edit --id <item-id> --project-id <project-id> \
  --field-id <status-field-id> --single-select-option-id <option-id>
```

## PR → Issue linking

Every PR that implements or fixes a tracked issue should reference it.
Per Hard Rule 6, the keyword depends on the target branch:

- PR into `develop` (the normal case — see branch strategy in section 16
  of the proposal): use `Refs #<n>` — it links the issue without
  triggering GitHub's auto-close, since `develop` is not the default
  branch and the keyword wouldn't close anything anyway; the link still
  shows up in the issue's Development panel.
- PR into `main` (a `develop` → `main` release, or a direct `fix/*` → `main`
  hotfix): use `Closes #<n>` (or `Fixes`/`Resolves`) — this is the only
  merge that actually closes the issue and should move Status to `Done`.
