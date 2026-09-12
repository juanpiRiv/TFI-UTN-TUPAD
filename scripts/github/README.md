# scripts/github/

Wrappers de `gh` para no tener que escribir los comandos a mano. Las
convenciones que aplican (labels, títulos, módulos, columnas del board)
están en [`../../docs/CONTRIBUTING.md`](../../docs/CONTRIBUTING.md).

## Requisitos

- `gh` (GitHub CLI) y `jq` instalados.
- `gh auth login` con una cuenta colaboradora del repo.
- Para `setup-board.sh` y `add-to-board.sh` hace falta un scope extra:
  ```
  gh auth refresh -s project -s read:project
  ```

## new-issue.sh

```
./scripts/github/new-issue.sh <type> <scope> "<descripcion>" <label> [archivo-body.md]
```
Valida que la label exista, busca duplicados por título antes de crear, y
arma el título con el formato `<type>(<scope>): <descripcion>`.

## setup-board.sh

```
./scripts/github/setup-board.sh
```
Correrlo **una sola vez** para crear el Project Board del equipo. Guarda
el número del board en `project.env` — commitealo para que todo el mundo
use el mismo board en vez de crear uno cada uno.

## add-to-board.sh

```
./scripts/github/add-to-board.sh <numero-de-issue> "<Status>"
```
`<Status>` es una de las columnas del board: `Backlog`, `To Do`,
`In Progress`, `Review`, `Testing`, `Done`.
