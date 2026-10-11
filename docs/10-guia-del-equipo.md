# Guía del equipo: setup, issues, ramas y PRs

Para que cualquiera de los tres pueda levantar el proyecto y trabajar sin pedir ayuda. Las reglas de fondo están en [CONTRIBUTING.md](./CONTRIBUTING.md); acá está el paso a paso.

## 1. Instalar lo necesario (una sola vez)

| Qué | Para qué | Cómo |
| --- | --- | --- |
| Git | Control de versiones | https://git-scm.com. En Windows incluye Git Bash |
| Node 22.22 o superior | Correr backend y frontend | Según el sistema, ver la tabla de abajo. Siempre verificá con `node -v` |
| pnpm 10 | Instalar dependencias | `corepack enable` (viene con Node). Verificá con `pnpm -v`. Si falla en Windows, ver "Si algo falla" |
| Docker Desktop | Base de datos PostgreSQL | https://www.docker.com/products/docker-desktop |
| VS Code (recomendado) | Editor | Extensiones útiles: Prisma, ESLint, Prettier |
| GitHub CLI `gh` y `jq` | Scripts de issues y tablero (opcional, se puede hacer todo desde la web) | https://cli.github.com y `jq` desde tu gestor de paquetes |

En Windows, los scripts `.sh` se corren desde **Git Bash** o **WSL**, no desde PowerShell.

### Cómo instalar Node 22 según el sistema

| Sistema | Cómo |
| --- | --- |
| macOS, Linux y WSL | Con nvm: `nvm install 22 && nvm use 22` (dentro del repo, `nvm install` y `nvm use` toman la versión del `.nvmrc`). Alternativa: fnm |
| Windows (Git Bash) | Instalador de Node 22 LTS desde https://nodejs.org. Alternativas: fnm o volta |

`nvm-windows` es otro programa, distinto de nvm. Que lea el `.nvmrc` está sin verificar, así que en Windows no lo des por hecho: instalá Node 22.22 o superior y comprobalo con `node -v`.

### Identidad de Git (una sola vez)

Los commits se atribuyen a una persona por su email. Si el email de Git no es el de tu cuenta de GitHub, tus commits no aparecen a tu nombre, y la fecha y la autoría de los commits son la evidencia ante Oscar.

```bash
git config --global user.name "Tu Nombre"
git config --global user.email "el-email-verificado-en-tu-cuenta-de-github"
```

Tanto el `user.name` como el `user.email` tienen que ser los de tu cuenta de GitHub. El email lo ves en GitHub → Settings → Emails. Además, aceptá la invitación de colaborador al repo y iniciá sesión con `gh auth login` o con el Git Credential Manager que trae Git para Windows.

## 2. Levantar el proyecto

```bash
git clone https://github.com/juanpiRiv/TFI-UTN-TUPAD.git
cd TFI-UTN-TUPAD
node -v                # tiene que ser 22.22 o superior
./scripts/dev.sh       # prepara todo y levanta backend y frontend
```

Si usás **WSL**, cloná dentro del sistema de archivos de WSL (por ejemplo en `~/`) y no en `/mnt/c/...`. Mezclar Windows y WSL en la misma carpeta trae lentitud y problemas de permisos.

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
| `Se necesita Node >= 22.22` | Versión vieja de Node | macOS, Linux y WSL: `nvm install && nvm use`. Windows: instalar Node 22 LTS y abrir una terminal nueva |
| `EPERM: operation not permitted` al correr `corepack enable` en Windows | Node está en `C:\Program Files\nodejs` y la terminal no es de administrador | Abrir Git Bash **como administrador una sola vez** y correr `corepack enable`, o instalar pnpm con `npm install -g pnpm@10.33.0` |
| Puerto 5433 o 3000 ocupado | Otro servicio local, o un proceso que quedó abierto después de Ctrl+C | Frenarlo o cambiar el puerto en `.env` y `docker-compose.yml`. Para ver quién lo usa: en Windows `netstat -ano \| findstr :3000` y `taskkill /PID <pid> /F`; en macOS y Linux `lsof -i :3000` |
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
- Se mergea cuando está aprobado y los controles pasan. El método de merge (*Create a merge commit*, *Squash and merge* o *Rebase and merge*) es una decisión del equipo que todavía no se tomó: ver el recuadro de abajo.
- Después del merge, volvé a `develop` y actualizá:

```bash
git checkout develop && git pull
git fetch --prune
git branch -d feature/clients-crud
```

`git fetch --prune` limpia las referencias a ramas que GitHub ya borró. Si `git branch -d` dice *not fully merged* pero en GitHub el PR figura como *Merged*, es lo esperable después de un *Squash and merge*: git no reconoce los commits originales dentro de `develop`. En ese caso, confirmá que el PR está mergeado y recién ahí usá `git branch -D feature/clients-crud`. Con *Create a merge commit* el `-d` funciona sin avisos.

- **No muevas el issue a `Done` a mano.** Los workflows del tablero Roadmap-TUPAD lo hacen cuando el issue se cierra (en el tablero: menú ⋯ → *Workflows*; si algo no se mueve, verificá que estén activados, porque su estado actual en el tablero está sin verificar). Con el flujo actual, el issue se cierra con el `Closes #n` del PR de release a `main`, así que `Done` significa "llegó a `main`", siempre que el workflow de cierre automático al cambiar el estado siga apagado. `In progress` y `Blocked` sí se mueven a mano.

> **Decisión pendiente: modelo de ramas y método de merge**
>
> Esta guía y [CONTRIBUTING.md](./CONTRIBUTING.md) documentan hoy el flujo con `develop`. El equipo todavía no decidió si se mantiene o si se pasa a GitHub flow, ni qué método de merge se usa. Mientras no se decida, se sigue el flujo de esta guía y se pregunta al equipo antes de mergear.
>
> | Decisión | Opciones | Recomendación del informe de investigación |
> | --- | --- | --- |
> | Modelo de ramas | `develop` como rama de integración (flujo actual) o GitHub flow: ramas cortas desde `main`, PR a `main` y `Closes #n` en cada PR | GitHub flow, salvo que la propuesta ([docs/01](./01-propuesta.md), secciones 13 a 16) u Oscar exijan `develop`. Esa verificación está sin hacer |
> | Método de merge | Merge commit, squash o rebase | Permitir solo *Create a merge commit*: conserva autoría y fecha de cada commit, y `git branch -d` funciona después del merge |
>
> Si se mantiene `develop`, la recomendación es protegerla con un ruleset y desactivar *Automatically delete head branches*. Si se pasa a GitHub flow, cambian los pasos 1, 2, 4 y 6 y la sección 4: la rama sale de `main`, el PR va a `main` y cada PR usa `Closes #n`. Cuando se decida, se actualizan esta guía y CONTRIBUTING.md.

### Paso 6. Release a `main`

Antes de cada entrega, alguien abre un PR `develop → main` con `Closes #n` por cada issue terminado, cada uno en su propia línea. Oscar revisa `main`, por eso el release se abre unos días antes de la fecha límite. La fecha real de la entrega 3 es una decisión pendiente: hay que confirmarla con Oscar (ver [Plan de la entrega 3](./09-plan-entrega-3.md)).

### Planeado (se arma en un issue aparte)

Todavía no existen, y por eso hoy los controles son manuales (la lista del Paso 3 y los comandos del Paso 4):

- CI en GitHub Actions que corra lint, test y build en cada PR.
- Plantilla de PR y formularios de issues.
- Un hook `pre-commit` que bloquee `.env`, claves y certificados.

## 4. Mantener la rama al día

Si `develop` avanzó mientras trabajabas, traela a tu rama:

```bash
git fetch origin
git merge origin/develop
```

Si no hay conflictos, listo. Si los hay, git lo avisa y marca los archivos como *both modified* en `git status`. No hay apuro: la salida de emergencia siempre está disponible.

```bash
git merge --abort    # vuelve tu rama al estado de antes del merge
```

### Resolver un conflicto con VS Code

1. Abrí el archivo en VS Code. Sobre cada conflicto aparecen *Accept Current Change*, *Accept Incoming Change*, *Accept Both Changes* y *Compare Changes*. Para ver los tres paneles (Incoming, Current y Result abajo), usá *Resolve in Merge Editor*.
2. Leé el panel *Result* y comprobá que el código tenga sentido. No uses *Accept Both Changes* a ciegas: puede dejar código inválido. Si dudás, llamá a quien hizo el otro cambio.
3. *Complete Merge* en el Merge Editor solo hace `git add` de ese archivo: **no** termina el merge. Cuando no queden archivos sin resolver, hacé `git commit` (sin `-m`, queda el mensaje "Merge branch...").
4. Corré `pnpm lint`, `pnpm test` y `pnpm build`, y recién ahí `git push`.

### Archivos que no se resuelven a mano

Estas recetas son práctica general y están sin verificar en este repo. Ante la duda, avisá al equipo antes de resolver.

| Archivo | Qué hacer |
| --- | --- |
| `pnpm-lock.yaml` | No lo edites. Quedate con la versión que entra, regenerá el lock y commitealo: `git checkout --theirs pnpm-lock.yaml`, `pnpm install`, `git add pnpm-lock.yaml` |
| `backend/prisma/migrations/` | Las migraciones ya mergeadas no se editan: si hace falta un cambio, se crea una migración nueva. Si dos ramas crearon migraciones distintas, avisá al equipo. Si la tuya todavía no está mergeada, borrá su carpeta, mergeá, y volvé a generarla con `cd backend && pnpm db:migrate` sobre el esquema ya combinado. Si ya la habías aplicada en tu base local, empezá de cero con el comando `down -v` de la tabla de arriba |
| `database/schema.sql` | Es un archivo generado desde las migraciones ([plan de la entrega 3](./09-plan-entrega-3.md)). No lo combines a mano: quedate con una de las dos versiones y regeneralo una vez resueltas las migraciones. El comando para regenerarlo no está documentado todavía, preguntá al equipo |

Para tener menos conflictos: ramas cortas, PR chicos, y avisar al equipo antes de tocar archivos compartidos como `schema.prisma`, las rutas o `app.ts`.

## 5. Sesión de onboarding de 60 minutos

Para que los tres hagan el ciclo completo una vez antes de tocar el repo real. Se hace en un **repo de práctica descartable**, para no ensuciar los commits de `main` que Oscar toma como evidencia. La agenda es un diseño propio, todavía sin validar con el equipo, y los tiempos son estimaciones. La fecha se define cuando se resuelva la decisión pendiente de modelo de ramas, porque cambia los pasos de rama, PR y merge.

**Antes de la sesión (quien facilite, unos 20 minutos):**

- Crear el repo de práctica (por ejemplo `tfi-practica`) con un `README`, un archivo `PRACTICA.md` y los tres colaboradores invitados.
- Crear tres issues de práctica `docs(practica): ...` y cargarlos en un tablero de práctica.
- `PRACTICA.md` tiene una fila por persona y **una línea compartida** que los tres van a editar, para provocar un conflicto a propósito.
- Cada persona llega con Git, VS Code, `user.name` y `user.email` configurados, y el proyecto real corriendo con `./scripts/dev.sh` o el síntoma anotado.

| Min | Qué se hace | Resultado |
| --- | --- | --- |
| 0-5 | Dibujo del flujo: issue, rama, commit, PR, revisión, merge. Por qué `main` es la rama que lee Oscar | Todos explican las seis palabras |
| 5-12 | Chequeo del entorno: `git config user.email`, `node -v`, `pnpm -v`, `docker info`. Cada falla se anota en "Si algo falla" | Todos con el proyecto corriendo, o con el síntoma anotado |
| 12-20 | Cada persona toma su issue de práctica y lo mueve a `In progress`. Se muestra qué mueve el tablero solo y qué no | Tres tarjetas en `In progress` |
| 20-30 | Rama, edición de `PRACTICA.md` (su fila y la línea compartida), `git status`, `git diff --cached --name-only`, commit con formato `tipo(módulo)`, push | Tres ramas pusheadas |
| 30-38 | Abrir el PR, asignarse, pedir revisión a otra persona | Tres PR abiertos |
| 38-46 | Cada persona revisa el PR de otra. En uno se usa *Request changes* a propósito; el autor corrige con un commit nuevo y se aprueba | Un ciclo de revisión completo |
| 46-54 | Se mergea el primer PR. Los otros dos tienen conflicto en la línea compartida: `git merge`, Merge Editor, *Complete Merge*, `git commit`, push. También se practica `git merge --abort` | Tres PR mergeados y un conflicto resuelto por persona |
| 54-58 | Volver a la rama base, `git pull`, `git fetch --prune`, borrar las ramas locales, comprobar el estado de issues y tarjetas según el modelo de ramas decidido (con `develop`, los issues se cierran recién en el release) | Repo y tablero limpios |
| 58-60 | Releer las reglas del punto 7 y acordar quién revisa a quién y cómo pedir ayuda | Compromisos anotados |

Reglas de la sesión: una laptop por persona, se rota quién maneja el teclado, y ningún comando se copia sin leerlo en voz alta. Todo error que aparezca se agrega a esta guía. Como el hook `pre-commit` y la plantilla de PR están planeados, no forman parte de esta primera sesión.

## 6. Trabajar con issues desde la terminal (opcional)

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

## 7. Reglas que no se rompen

- Nada de `.env`, claves ni certificados en el repo.
- Nada de `push --force` sobre `main` o `develop`, ni reescribir historia ya pusheada.
- No se mergea a `main` sin que el equipo lo sepa.
- Un PR chico y enfocado en un issue vale más que uno grande con todo mezclado.
- Todo `.md` nuevo se agrega a la tabla de documentación del README y las imágenes viven en `docs/img/`.
- Los criterios de aceptación de facturas, pagos y movimientos incluyen las reglas de [atomicidad y concurrencia](./02-atomicidad-concurrencia.md).

## 8. Dónde está cada cosa

| Quiero saber | Dónde |
| --- | --- |
| Qué hay que hacer para la próxima entrega | [Plan de la entrega 3](./09-plan-entrega-3.md) |
| Qué endpoints espera el frontend | [Contrato de la API](./08-contrato-api.md) |
| Cómo es el modelo de datos | [Modelo de datos](./03-modelo-de-datos.md) |
| Cómo se estructura un módulo del backend | `backend/src/module/auth/` como ejemplo |
| Cómo funciona el frontend | [README del frontend](../frontend/README.md) |
| Reglas de ramas, labels y módulos | [CONTRIBUTING.md](./CONTRIBUTING.md) |
