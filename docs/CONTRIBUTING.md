# Guía de contribución: TFI-UTN-TUPAD

Convenciones de ramas, issues y Project Board para el equipo (Rivero
Albornoz, Rios, Riveros Valgañón). Basado en la propuesta aceptada
([`docs/01-propuesta.md`](./01-propuesta.md), secciones 13-16).

## Ramas

- `main`: rama estable, solo código revisado.
- `develop`: integración de todas las features.
- `feature/<nombre>`: una rama por funcionalidad, sale de `develop` y
  vuelve a `develop` (ej: `feature/client-module`).
- `fix/<nombre>`: correcciones puntuales sobre `develop`, o directo sobre
  `main` para un hotfix urgente.

**Ojo:** el repo tiene activado "Automatically delete head branches", así
que cuando se mergea un PR de `develop` hacia `main`, GitHub borra
`develop` sola. Si eso pasa, recrearla desde `main`
(`git checkout main && git pull && git checkout -b develop && git push -u origin develop`)
antes de abrir la siguiente `feature/*`. Si molesta, se puede desactivar
en Settings → General → Pull Requests del repo.

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
`security-fix`, no los uses hasta que alguien los cree a propósito.

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

Del catálogo de requerimientos (RF-01..34) en [`docs/01-propuesta.md`](./01-propuesta.md#13-requerimientos-funcionales):

| Módulo | Cubre |
| --- | --- |
| `auth` | Autenticación (RF-01, RF-02, RF-03) |
| `users` | Perfil de usuario (RF-04) |
| `organizations` | Datos del negocio, moneda base (RF-05, RF-06) |
| `clients` | ABM y búsqueda de clientes, historial (RF-07..RF-11) |
| `categories` | Categorización de movimientos (RF-14) |
| `transactions` | Ingresos/egresos, filtros (RF-12, RF-13, RF-15, RF-16, RF-17) |
| `dashboard` | Totales del período, resultado de gestión, gráficos (RF-31..RF-34) |
| `exchange-rates` | Cotizaciones BCRA (RF-18..RF-21) |
| `invoices` | Facturas, totales, PDF (RF-22, RF-23, RF-27, RF-28) |
| `arca` | Integración WSFEv1, CAE (RF-24, RF-25, RF-26) |
| `payments` | Pagos, saldo, facturado vs. cobrado (RF-29, RF-30, RF-33) |
| `notifications` | WhatsApp/Kapso (evolutivo, post-MVP) | |
| `reports` | Reportes del período | |
| `audit` | Trazabilidad (RNF-08) | |

Los requerimientos no funcionales (RNF-01..12) y las reglas de negocio
(RN-01..14) van **dentro** del issue del módulo que restringen (como
criterio de aceptación), no como issues aparte. Al armar el backlog inicial,
un issue por módulo/slice de funcionalidad, no uno por cada RF suelto.

## Issues y Project Board

Usar los scripts de `scripts/github/` en vez de escribir los comandos de
`gh` a mano, ver `scripts/github/README.md` para el detalle de uso:

- `new-issue.sh`: crea el issue con el título y la label correctos, y
  busca duplicados antes de crearlo.
- `setup-board.sh`: deja armado `scripts/github/project.env` apuntando al
  board (ya no hace falta correrlo: el board ya existe, ver abajo).
- `add-to-board.sh`: agrega un issue existente al board y le pone estado.

El board del equipo es **Roadmap-TUPAD** (`gh project view 9 --owner
juanpiRiv`), ya linkeado al repo. Su número está guardado en
`scripts/github/project.env`. A diferencia de lo que decía la propuesta
original (6 columnas), el Status real tiene 4 opciones: `Todo`,
`In progress`, `Done`, `Blocked`. El board también trae un campo nativo
**Priority** con `P0`/`P1`/`P2`, usarlo en vez de (o además de) escribir
la prioridad solo en el cuerpo del issue.

## Vincular el PR con el issue

- PR hacia `develop` (el caso normal): usar `Refs #<n>` en el body. No
  cierra el issue, `develop` no es la rama default, así que `Closes` no
  dispararía nada ahí; `Refs` igual deja el link visible en el issue.
- PR hacia `main` (release desde `develop`, o un `fix/*` directo a `main`):
  usar `Closes #<n>` (o `Fixes`/`Resolves`), ese merge sí cierra el issue.

**Ojo:** `Closes` dentro de un PR a `develop` no cierra nada, aunque esté
escrito. GitHub solo cierra el issue cuando el PR entra a la rama default
(`main`). Por eso, al mergear un PR a `develop`, el issue hay que cerrarlo
a mano (como "completed") y pasarlo a `Done` en el tablero; si no, queda
abierto y en `In progress` hasta el próximo release. Quien mergea el PR es
quien cierra el issue.

## Requisitos para correr los scripts

- [GitHub CLI](https://cli.github.com/) (`gh`) y `jq` instalados.
- `gh auth login` ya hecho con una cuenta colaboradora del repo (Rivero
  Albornoz, Rios y Riveros Valgañón ya son colaboradores).
- Para tocar el Project Board hace falta un scope extra en el token:
  ```
  gh auth refresh -s project -s read:project
  ```

## Integración continua

El workflow [`ci.yml`](../.github/workflows/ci.yml) corre en cada PR hacia `develop` o `main`: instala, migra una base PostgreSQL propia del job (no la de desarrollo), y corre `pnpm lint`, `pnpm build` y `pnpm test`, incluidos los tests de integración. Para repetirlo en tu máquina: `docker compose up -d` en `backend/`, `pnpm --filter backend exec prisma migrate deploy` y `pnpm test` (con `DATABASE_URL`, `JWT_SECRET` y `ARCA_PROVIDER=simulated` en `backend/.env`). Los PRs usan la plantilla de [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md).

## Deploy del frontend

El deploy completo (backend y base en Render, frontend en Cloudflare) y
dónde va cada secreto están en [`docs/09-deploy.md`](./09-deploy.md).

El workflow [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml)
publica el frontend en Cloudflare Pages cuando entra un cambio a `main`
(o a mano desde Actions > Deploy frontend > Run workflow). Antes de
publicar corre lint, tests y build.

Configuración en GitHub (Settings > Secrets and variables > Actions), a
cargar por quien administra la cuenta de Cloudflare, nunca en el repo:

| Tipo | Nombre | Para qué |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Token con el permiso Cloudflare Pages: Edit, con vencimiento |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Identificador de la cuenta |
| Variable | `CLOUDFLARE_PAGES_PROJECT` | Nombre del proyecto en Pages (por defecto `tfi-tupad`) |
| Variable | `VITE_API_URL` | URL pública del backend |
| Variable | `VITE_MOCK_MODULES` | Módulos a simular con MSW (vacío = usa la API real, que es lo normal) |

El proyecto de Pages tiene que existir antes del primer deploy
(`wrangler pages project create tfi-tupad --production-branch=main`).
Si `VITE_MOCK_MODULES` tiene módulos, el sitio publicado simula esos
módulos con datos de prueba; vacío usa siempre `VITE_API_URL`.
