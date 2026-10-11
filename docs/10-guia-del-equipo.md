# Guía del equipo: setup, issues, ramas y PRs

Para que cualquiera de los tres pueda levantar el proyecto y trabajar sin pedir ayuda. Las reglas de fondo están en [CONTRIBUTING.md](./CONTRIBUTING.md); acá está el paso a paso.

## 1. Instalar lo necesario (una sola vez)

| Qué | Para qué | Cómo |
| --- | --- | --- |
| Git | Control de versiones | https://git-scm.com. En Windows incluye Git Bash |
| Node 22.22 o superior | Correr backend y frontend | Con nvm: `nvm install` dentro del repo toma la versión del `.nvmrc` |
| pnpm 10 | Instalar dependencias | `corepack enable` (viene con Node) |
| Docker Desktop | Base de datos PostgreSQL | https://www.docker.com/products/docker-desktop |
| VS Code (recomendado) | Editor | Extensiones útiles: Prisma, ESLint, Prettier |
| GitHub CLI `gh` y `jq` | Scripts de issues y tablero (opcional, se puede hacer todo desde la web) | https://cli.github.com y `jq` desde tu gestor de paquetes |

En Windows, los scripts `.sh` se corren desde **Git Bash** o **WSL**, no desde PowerShell.

## 2. Levantar el proyecto

```bash
git clone https://github.com/juanpiRiv/TFI-UTN-TUPAD.git
cd TFI-UTN-TUPAD
nvm use                # toma la versión de .nvmrc
./scripts/dev.sh       # prepara todo y levanta backend y frontend
```

`./scripts/dev.sh` corre primero `scripts/setup.sh`, que:

1. verifica Node, pnpm y que Docker esté corriendo;
2. hace `pnpm install` (también genera el cliente de Prisma);
3. crea `backend/.env` con un `JWT_SECRET` generado, y `frontend/.env.local`;
4. levanta PostgreSQL con Docker en el puerto **5433**;
5. aplica las migraciones.

Después arranca la API en http://localhost:3000 y la web en http://localhost:5173. Se puede correr las veces que haga falta: solo completa lo que falta. Ctrl+C frena backend y frontend, la base queda corriendo.

### Mocks o backend real

El archivo `frontend/.env.local` tiene `VITE_USE_MOCKS=true`. Con eso el frontend simula los módulos que todavía no existen en el backend con MSW. A medida que se mergea un módulo real, hay que dejar de mockearlo. Para probar contra el backend real, poner `VITE_USE_MOCKS=false` y reiniciar el frontend.

### Comandos del día a día

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` (raíz) | Backend y frontend juntos |
| `pnpm lint`, `pnpm test`, `pnpm build` (raíz) | Los controles que tiene que pasar un PR |
| `cd backend && pnpm db:studio` | Interfaz web para mirar las tablas |
| `cd backend && pnpm db:migrate` | Crea una migración nueva después de tocar `prisma/schema/` |
| `cd backend && pnpm exec prisma migrate deploy` | Aplica las migraciones que otro ya creó |
| `docker compose -f backend/docker-compose.yml down -v` | Borra la base local y empieza de cero |

### Si algo falla

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `Docker no esta corriendo` | Docker Desktop cerrado | Abrirlo y esperar a que arranque |
| `Se necesita Node >= 22.22` | Versión vieja de Node | `nvm install && nvm use` |
| Puerto 5433 o 3000 ocupado | Otro servicio local | Frenarlo o cambiar el puerto en `.env` y `docker-compose.yml` |
| Error de Prisma por tablas que faltan | No se corrieron las migraciones | `cd backend && pnpm exec prisma migrate deploy` |
| Después de un `git pull` falla el backend | Hay migraciones o dependencias nuevas | `pnpm install` y `prisma migrate deploy` |

El `.env` **nunca** se commitea, ni claves ni certificados de ARCA (`*.key`, `*.crt`, `*.pem`, `*.pfx`).

## 3. Cómo se trabaja: issue, rama, PR

El flujo siempre es el mismo:

```
issue  →  rama desde develop  →  commits chicos  →  PR a develop  →  revisión  →  merge
```

### Paso 1. Elegir un issue

1. Entrá al tablero [Roadmap-TUPAD](https://github.com/users/juanpiRiv/projects/9).
2. Elegí un issue de la columna `Todo` que esté asignado a vos, con prioridad `P0` primero.
3. Leé la descripción y los **criterios de cierre**: son tu lista de qué tiene que estar hecho.
4. Mové la tarjeta a `In progress`. Si te trabás por algo externo, a `Blocked` y dejás un comentario con el motivo.

Para crear un issue nuevo: pestaña *Issues* → *New issue*. El título sigue `tipo(módulo): descripción en minúscula`, por ejemplo `feat(clients): alta y baja logica de clientes`. Tipos: `feat`, `fix`, `docs`, `chore`. Módulos: `auth`, `users`, `organizations`, `clients`, `categories`, `transactions`, `dashboard`, `exchange-rates`, `invoices`, `arca`, `payments`, `audit`, `docs`. Labels disponibles: `enhancement` (para `feat` y `chore`), `bug` (para `fix`) y `documentation` (para `docs`). Antes de crear, buscá si ya existe uno parecido.

### Paso 2. Crear la rama

```bash
git fetch origin
git checkout develop
git pull
git checkout -b feature/clients-crud     # nombre corto, en kebab-case
```

Prefijos: `feature/` para funcionalidades, `fix/` para correcciones, `docs/` y `chore/` para lo demás. **Nunca se trabaja directo en `main` ni en `develop`.**

#### Recrear `develop`

El repo borra automáticamente la rama de origen al mergear un PR `develop → main`. Si `git checkout develop` falla porque no existe en el remoto:

```bash
git checkout main && git pull
git checkout -b develop
git push -u origin develop
```

Para que no vuelva a pasar, se puede desactivar *Automatically delete head branches* en Settings → General → Pull Requests.

### Paso 3. Commits

Chicos y frecuentes, con este formato:

```
<tipo>(<módulo>): <descripción en minúscula y en español>
```

Ejemplos: `feat(clients): agregar alta de clientes`, `fix(auth): validar el token vencido`, `docs(readme): actualizar estado del backend`.

Antes de cada commit mirá qué va a entrar:

```bash
git status
git diff --cached --name-only    # revisar que no haya .env, claves ni node_modules
git add <archivos>               # evitar "git add ." si no revisaste
git commit -m "feat(clients): agregar alta de clientes"
git push -u origin feature/clients-crud
```

La fecha de los commits es la evidencia de entrega ante Oscar, así que se pushea seguido.

### Paso 4. Abrir el PR

1. Después del push, GitHub muestra un botón *Compare & pull request*.
2. **Base: `develop`**. Compare: tu rama.
3. Título con el mismo formato que el commit.
4. En el cuerpo: qué cambia, cómo probarlo, capturas si hay pantallas, y `Refs #<número del issue>`.
5. Asignate y pedí revisión a otro integrante.

Antes de abrir el PR, corré `pnpm lint`, `pnpm test` y `pnpm build`.

**`Refs` y `Closes`:** a `develop` se usa `Refs #12`, porque `Closes` solo cierra issues cuando el PR va a la rama principal (`main`). Los PR de release `develop → main` usan `Closes #12` para cada issue terminado, y ahí sí se cierran.

### Paso 5. Revisión y merge

- Otra persona revisa el código y comenta o aprueba. Quien abrió el PR responde y corrige en la misma rama: los commits nuevos se suman solos al PR.
- Se mergea con *Squash and merge* o *Merge*, según lo que se acuerde en el equipo, cuando está aprobado y los controles pasan.
- Después del merge, volvé a `develop` y actualizá:

```bash
git checkout develop && git pull
git branch -d feature/clients-crud
```

- Mové el issue a `Done` cuando el trabajo esté en `main`, o a tu criterio al mergear a `develop` si el equipo lo prefiere.

### Paso 6. Release a `main`

Antes de cada entrega, alguien abre un PR `develop → main` con `Closes #n` por cada issue terminado. Oscar revisa `main`, por eso el release se abre unos días antes de la fecha límite.

## 4. Mantener la rama al día

Si `develop` avanzó mientras trabajabas, traela a tu rama:

```bash
git fetch origin
git merge origin/develop
```

Si hay conflictos, git marca los archivos. Abrilos en VS Code, elegí qué versión conservar o combiná las dos, y después `git add <archivo>` y `git commit`. En `schema.prisma` y las migraciones, avisá al equipo antes de resolver: no se editan a mano migraciones ya creadas, se crea una nueva.

## 5. Trabajar con issues desde la terminal (opcional)

Requiere `gh auth login` y, para el tablero, `gh auth refresh -s project -s read:project`. Más detalle en [`scripts/github/README.md`](../scripts/github/README.md).

```bash
# Ver mis issues abiertos
gh issue list --repo juanpiRiv/TFI-UTN-TUPAD --assignee @me

# Crear un issue (valida la label y busca duplicados)
./scripts/github/new-issue.sh feat clients "alta y baja logica de clientes" enhancement cuerpo.md

# Mover un issue en el tablero
./scripts/github/add-to-board.sh 28 "In progress"

# Abrir un PR
gh pr create --base develop --title "feat(clients): crud de clientes" --body "Refs #28"
```

## 6. Reglas que no se rompen

- Nada de `.env`, claves ni certificados en el repo.
- Nada de `push --force` sobre `main` o `develop`, ni reescribir historia ya pusheada.
- No se mergea a `main` sin que el equipo lo sepa.
- Un PR chico y enfocado en un issue vale más que uno grande con todo mezclado.
- Todo `.md` nuevo se agrega a la tabla de documentación del README y las imágenes viven en `docs/img/`.
- Los criterios de aceptación de facturas, pagos y movimientos incluyen las reglas de [atomicidad y concurrencia](./02-atomicidad-concurrencia.md).

## 7. Dónde está cada cosa

| Quiero saber | Dónde |
| --- | --- |
| Qué hay que hacer para la próxima entrega | [Plan de la entrega 3](./09-plan-entrega-3.md) |
| Qué endpoints espera el frontend | [Contrato de la API](./08-contrato-api.md) |
| Cómo es el modelo de datos | [Modelo de datos](./03-modelo-de-datos.md) |
| Cómo se estructura un módulo del backend | `backend/src/module/auth/` como ejemplo |
| Cómo funciona el frontend | [README del frontend](../frontend/README.md) |
| Reglas de ramas, labels y módulos | [CONTRIBUTING.md](./CONTRIBUTING.md) |
