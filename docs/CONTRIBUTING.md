# Guía de contribución — TFI-UTN-TUPAD

Convenciones de ramas, issues y Project Board para el equipo (Rivero
Albornoz, Rios, Riveros Valgañón). Basado en la propuesta aceptada
(`docs/TFI_Primera_Entrega.pdf`, secciones 13-16).

## Ramas

- `main` — rama estable, solo código revisado.
- `develop` — integración de todas las features.
- `feature/<nombre>` — una rama por funcionalidad, sale de `develop` y
  vuelve a `develop` (ej: `feature/client-module`).
- `fix/<nombre>` — correcciones puntuales sobre `develop`, o directo sobre
  `main` para un hotfix urgente.

## Convención de títulos (issues y PRs)

```
<type>(<scope>): <descripción>
```

`type`: `feat` | `fix` | `docs` | `chore`.
`scope`: uno de los módulos de la tabla más abajo.

Ejemplos: `feat(clients): alta y baja logica de clientes`,
`fix(arca): manejo de rechazo WSFEv1`,
`docs(readme): actualizar stack tecnologico`.

## Labels del repo

Las reales hoy (verificar con `gh label list --repo juanpiRiv/TFI-UTN-TUPAD`,
pueden cambiar): `accessibility`, `bug`, `documentation`, `duplicate`,
`enhancement`, `good first issue`, `help wanted`, `invalid`, `question`,
`wontfix`. No existe `chore`, `priority:*`, `dependencies` ni
`security-fix` — no los uses hasta que alguien los cree a propósito.

| Situación | Label | `type` del título |
| --- | --- | --- |
| Algo roto / comportamiento incorrecto | `bug` | `fix` |
| Módulo, endpoint o pantalla nueva hacia el MVP | `enhancement` | `feat` |
| Tooling, refactor, housekeeping | `enhancement` | `chore` |
| Solo documentación (README, docs/) | `documentation` | `docs` |
| Accesibilidad | `accessibility` (+ `bug` o `enhancement` según corresponda) | `fix`/`feat` |

`question`, `invalid`, `wontfix`, `duplicate` son de triage: las aplica
quien revisa, nunca quien crea el issue.

## Módulos (scope) y qué requerimientos cubren

Del catálogo de requerimientos (RF-01..34) en `docs/TFI_Primera_Entrega.pdf`:

| Módulo | Cubre |
| --- | --- |
| `auth` | Autenticación — RF-01, RF-02, RF-03 |
| `users` | Perfil de usuario — RF-04 |
| `organizations` | Datos del negocio, moneda base — RF-05, RF-06 |
| `clients` | ABM y búsqueda de clientes, historial — RF-07..RF-11 |
| `categories` | Categorización de movimientos — RF-14 |
| `transactions` | Ingresos/egresos, filtros — RF-12, RF-13, RF-15, RF-16, RF-17 |
| `dashboard` | Totales del período, resultado de gestión, gráficos — RF-31..RF-34 |
| `exchange-rates` | Cotizaciones BCRA — RF-18..RF-21 |
| `invoices` | Facturas, totales, PDF — RF-22, RF-23, RF-27, RF-28 |
| `arca` | Integración WSFEv1, CAE — RF-24, RF-25, RF-26 |
| `payments` | Pagos, saldo, facturado vs. cobrado — RF-29, RF-30, RF-33 |
| `notifications` | WhatsApp/Kapso (evolutivo, post-MVP) | |
| `reports` | Reportes del período | |
| `audit` | Trazabilidad — RNF-08 | |

Los requerimientos no funcionales (RNF-01..12) y las reglas de negocio
(RN-01..14) van **dentro** del issue del módulo que restringen (como
criterio de aceptación), no como issues aparte. Al armar el backlog inicial,
un issue por módulo/slice de funcionalidad — no uno por cada RF suelto.

## Issues y Project Board

Usar los scripts de `scripts/github/` en vez de escribir los comandos de
`gh` a mano — ver `scripts/github/README.md` para el detalle de uso:

- `new-issue.sh` — crea el issue con el título y la label correctos, y
  busca duplicados antes de crearlo.
- `setup-board.sh` — crea el Project Board una sola vez (lo corre quien
  tenga el scope de `project` primero).
- `add-to-board.sh` — agrega un issue existente al board y le pone estado.

El board tiene 6 columnas de Status (definidas en la propuesta, sección 16):
`Backlog`, `To Do`, `In Progress`, `Review`, `Testing`, `Done`.

## Vincular el PR con el issue

- PR hacia `develop` (el caso normal): usar `Refs #<n>` en el body. No
  cierra el issue — `develop` no es la rama default, así que `Closes` no
  dispararía nada ahí; `Refs` igual deja el link visible en el issue.
- PR hacia `main` (release desde `develop`, o un `fix/*` directo a `main`):
  usar `Closes #<n>` (o `Fixes`/`Resolves`) — ese merge sí cierra el issue.

## Requisitos para correr los scripts

- [GitHub CLI](https://cli.github.com/) (`gh`) y `jq` instalados.
- `gh auth login` ya hecho con una cuenta colaboradora del repo (Rivero
  Albornoz, Rios y Riveros Valgañón ya son colaboradores).
- Para tocar el Project Board hace falta un scope extra en el token:
  ```
  gh auth refresh -s project -s read:project
  ```
