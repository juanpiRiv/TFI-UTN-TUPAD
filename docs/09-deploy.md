# Deploy: backend y base de datos en Railway, frontend en Cloudflare

Dónde vive cada pieza, quién configura qué y los pasos para dejarlo andando. El backend y la base de datos viven juntos en un proyecto de Railway. El frontend vive en Cloudflare Pages y se publica con un workflow de GitHub Actions.

| Pieza | Dónde | Cómo se publica |
|---|---|---|
| Backend (API) | Railway, servicio `backend` | Railway lo construye desde `backend/Dockerfile` cada vez que cambia `main` |
| Base de datos | Railway, servicio PostgreSQL del mismo proyecto | Las migraciones de Prisma corren solas al arrancar el backend |
| Frontend | Cloudflare Pages, proyecto `tfi-tupad` | [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml) |

## Dónde viven los secretos

Cada secreto vive en un solo lugar, el de quien lo usa. Nunca van al repositorio (RN-14).

### Backend (variables del servicio `backend` en Railway)

| Variable | Qué es | Cómo se carga | ¿La lee hoy el backend? |
|---|---|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL | Referencia `${{Postgres.DATABASE_URL}}` | Sí |
| `JWT_SECRET` | Firma de los tokens de sesión, 32 caracteres o más | Generarlo con `openssl rand -hex 32` | Sí |
| `CORS_ORIGIN` | Orígenes permitidos, separados por coma | `https://tfi-tupad.pages.dev` | Sí |
| `PORT` | Puerto de la API | Lo inyecta Railway, no se carga | Sí |
| `NODE_ENV` | Ambiente | Lo fija el Dockerfile en `production`, no se carga | Sí |
| `ARCA_MODE` | `homologacion` (por defecto) o `produccion` | Variable normal, opcional | Sí, desde #151 |
| `ARCA_PROVIDER` | Qué proveedor fiscal se usa: `simulated`, `sdk` o `direct` | Variable normal. **Obligatoria**: sin ella el backend no arranca. Usar `simulated` hasta tener la emisión real | Sí, desde #151 |
| `ARCA_ENCRYPTION_KEY` | Clave que cifra en la base la clave privada de cada organización | Generarla con `openssl rand -hex 32`. Es un secreto | Sí: la lee el backend (cifra la clave privada y el ticket de WSAA) |

`ARCA_PROVIDER` hay que cargarla desde el primer despliegue, porque el backend la valida al arrancar (cambio de #151). `ARCA_ENCRYPTION_KEY` hay que cargarla antes de que una organización guarde su credencial.

### Credenciales de ARCA: no son variables

El certificado y la clave privada de ARCA no se cargan en Railway ni en GitHub. Según el [modelo de datos](./03-modelo-de-datos.md), se guardan por organización y ambiente en la tabla `ArcaCredential`: el certificado y la clave privada cifrada con `ARCA_ENCRYPTION_KEY`, más el ticket de acceso de WSAA. Se cargan desde la pantalla de la organización o con `POST /api/organizations/me/arca-credential`.

Hoy el certificado de homologación vive solo en la computadora del titular del CUIT, fuera del repositorio, y no hay que subirlo a ningún lado. Si se pierde `ARCA_ENCRYPTION_KEY`, las claves cifradas en la base no se pueden recuperar, así que conviene guardarla también en un gestor de contraseñas.

### Frontend y publicación (secrets y variables de GitHub Actions)

| Dato | Tipo | Quién lo usa |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | Workflow del frontend |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Workflow del frontend |
| `CLOUDFLARE_PAGES_PROJECT` | Variable (opcional, por defecto `tfi-tupad`) | Workflow del frontend |
| `VITE_API_URL` | Variable | Build del frontend |
| `VITE_MOCK_MODULES` | Variable (vacía = usa la API real; es lo normal) | Build del frontend |

Las variables `VITE_*` quedan incluidas en el sitio publicado y las ve cualquiera: no pueden ser secretos.

El backend no usa secrets de GitHub: Railway se conecta al repositorio y construye por su cuenta. Por eso no hace falta un token de Railway en GitHub.

## Paso a paso: crear el proyecto en Railway

Lo hace la persona dueña de la cuenta de Railway (Brian). Los pasos son por el panel web.

1. Crear la cuenta con GitHub y activar la prueba gratuita. La prueba da un crédito único de USD 5. Cuando se agota, el servicio se detiene y hay que pasar al plan Hobby (USD 5 por mes) o migrar. Los datos de los volúmenes de un plan vencido se borran a los 30 días.
2. New Project → Deploy PostgreSQL. Queda un servicio llamado `Postgres`.
3. En el mismo proyecto: New → GitHub Repo → elegir `juanpiRiv/TFI-UTN-TUPAD`. Railway va a leer [`railway.toml`](../railway.toml) del repositorio. Si no ofrece la rama, configurar `main` como rama de despliegue en Settings → Source.
4. Cargar las variables del servicio `backend` (Variables):
   - `DATABASE_URL` con el valor `${{Postgres.DATABASE_URL}}` (referencia al servicio de la base, no se copia la clave).
   - `JWT_SECRET`: un valor propio de 32 caracteres o más. Se genera con `openssl rand -hex 32`.
   - `CORS_ORIGIN` con `https://tfi-tupad.pages.dev`.
   - `ARCA_PROVIDER` con el valor `simulated` (obligatoria; sin ella el backend no arranca). `ARCA_MODE` queda en `homologacion` por defecto. `ARCA_ENCRYPTION_KEY` se carga más adelante (ver la tabla de arriba).
5. En Settings → Networking → Generate Domain, para tener una URL pública.
6. Invitar al resto del equipo: Project Settings → Members → invitar por correo o con un enlace.
7. Ver los logs en la pestaña Deployments del servicio. El primer arranque corre las migraciones sobre la base vacía.

## Después: conectar el frontend

1. Probar que el backend responde en su URL pública.
2. En GitHub (Settings → Secrets and variables → Actions → Variables), cargar `VITE_API_URL` con esa URL. `VITE_MOCK_MODULES` se deja sin definir, para que el sitio use la API real.
3. Relanzar el workflow del frontend (Actions → Deploy frontend → Run workflow).
4. Probar el recorrido completo en las URLs publicadas: ingreso, cliente, movimiento, factura, pago y dashboard.

## Cosas a tener en cuenta

- El backend todavía no tiene una ruta de health. Railway lo da por vivo cuando el proceso arranca.
- Si el crédito de prueba se agota, la alternativa sin costo es el mismo Dockerfile en Render (el servicio gratuito se duerme tras 15 minutos sin uso) con la base en Supabase (conexión por el session pooler, que mantiene los bloqueos de `pg_advisory_lock`). No está configurada.
- El backend lee `ARCA_PROVIDER` y `ARCA_MODE` desde #151, pero todavía nada emite comprobantes con el proveedor elegido (ver [Plan B de ARCA](./06-plan-b-arca.md)).

## ARCA en homologación

La facturación contra ARCA se prueba solo en homologación (`ARCA_MODE=homologacion`). Con `ARCA_PROVIDER=sdk`, producción queda bloqueada salvo que se escriba `ARCA_ALLOW_PRODUCTION=true`, y no hace falta en este proyecto.

**Variables del backend**

| Variable | Para qué sirve |
| --- | --- |
| `ARCA_PROVIDER` | `simulated` (demo, sin validez fiscal) o `sdk` (ARCA de verdad). Obligatoria. |
| `ARCA_MODE` | `homologacion` por defecto. |
| `ARCA_ENCRYPTION_KEY` | 64 caracteres hexadecimales (`openssl rand -hex 32`). Cifra la clave privada que cada organización carga. Si se pierde, hay que volver a cargar las credenciales. |
| `ARCA_CUIT`, `ARCA_CERT_PATH` y `ARCA_KEY_PATH` (o `ARCA_CERT_PEM` y `ARCA_KEY_PEM`) | Solo para desarrollo: credenciales de prueba que se usan si la organización no cargó la suya. |
| `ARCA_SESSION_DIR` | Solo para el almacén en archivo (sin base de datos): carpeta donde se comparte el ticket de acceso de WSAA entre procesos. Por defecto `~/.arca-homologacion/sessions`. |

**El ticket de acceso.** ARCA entrega un ticket de WSAA que dura 12 horas y no da otro mientras ese siga vigente: responde `coe.alreadyAuthenticated`. Por eso todas las instancias tienen que compartir el mismo ticket. El backend lo guarda en la tabla `arca_wsaa_tickets` de PostgreSQL, con el token y la firma cifrados con `ARCA_ENCRYPTION_KEY` (AES-256-GCM), y usa un bloqueo asesor de PostgreSQL para que, si varias instancias lo necesitan a la vez, solo una lo pida a ARCA y las demás reutilicen el resultado. Esto permite correr más de una instancia en Render, incluso con disco efímero. Si un ticket guardado no se puede descifrar con la clave de esa instancia (por ejemplo, durante una rotación), esa instancia lo ignora pero no lo borra: lo puede leer otra con la clave correcta. Cada proceso toma como máximo 3 bloqueos a la vez para no agotar las conexiones de la base.

Cuando no hay base de datos o falta `ARCA_ENCRYPTION_KEY` (desarrollo y scripts como `arca:smoke`), se usa en cambio un archivo con permisos 600 en `ARCA_SESSION_DIR`, que alcanza con una sola máquina. El ticket de una credencial borrada o reemplazada no se limpia de inmediato: queda inutilizable y vence solo en 12 horas como máximo.

**Rotar `ARCA_ENCRYPTION_KEY`.** Conviene hacerlo si la clave se filtró o por política. Desde `backend/`, con la base de producción en `DATABASE_URL`:

1. Hacer un backup de la base.
2. Generar la clave nueva: `openssl rand -hex 32`.
3. Simular (no escribe nada): `ARCA_OLD_ENCRYPTION_KEY=<vieja> ARCA_NEW_ENCRYPTION_KEY=<nueva> pnpm arca:rotate-key`.
4. Aplicar: el mismo comando con `--apply`. Vuelve a cifrar las claves privadas y los tickets de WSAA vigentes en una sola transacción: si una credencial no se descifra ni con la clave vieja ni con la nueva, no cambia nada. Se puede repetir sin riesgo.
5. Cambiar `ARCA_ENCRYPTION_KEY` en el servidor por la clave nueva y reiniciar.

Si alguien guarda una credencial mientras se rota, la rotación aborta sin cambiar nada y hay que repetirla. Entre los pasos 4 y 5 el servidor con la clave vieja no puede descifrar las credenciales y las emisiones por ARCA fallan con un error claro: conviene hacerlo en una ventana corta. Las claves se pasan por variables de entorno y el script imprime solo cantidades.

**Credencial por organización.** El cliente carga su certificado y su clave en la pantalla de la organización (`/organizacion`). Los pasos que hace antes en ARCA están en [la guía del cliente](./arca/alta-de-cliente.md).

**Chequeos locales** (desde `backend/`, con las variables ARCA_* cargadas):

- `pnpm arca:smoke 1,2`: autentica en el WSAA, consulta el próximo número de Factura C de cada punto de venta y el catálogo de condiciones de IVA. No emite nada.
- `pnpm arca:e2e 1,2`: con el backend local levantado, crea un usuario y una organización de prueba y emite una Factura C de $ 1500 por punto de venta. Con `E2E_UPLOAD_CREDENTIAL=true` carga antes el certificado y la clave por la API, como lo haría un cliente.

**GitHub Actions.** El CI normal (`ci.yml`) usa el proveedor simulado y no necesita secretos. Hay un workflow aparte y manual, `arca-homologacion.yml`, que corre el chequeo de solo lectura. Para usarlo hay que crear el environment `arca-homologacion` con un **revisor obligatorio** y **restringir sus ramas de despliegue a `develop`** (Settings > Environments > Deployment branches): ese es el control real, porque el `if` del workflow se puede editar en otra rama. Los secrets son `ARCA_CUIT`, `ARCA_CERT_PEM` y `ARCA_KEY_PEM`, y solo los ve el paso que corre el chequeo. Corre una vez a la vez y no guarda el ticket en ningún cache.

**Límite conocido:** como el ticket no se guarda, una segunda corrida dentro de las 12 horas con el mismo certificado falla con `coe.alreadyAuthenticated`, igual que si otra máquina lo estuviera usando. Por eso conviene un **certificado exclusivo para el CI**, distinto al de desarrollo: dos certificados distintos no se pisan el ticket.

Al borrar o reemplazar una credencial de organización, el cliente guardado en memoria se descarta, pero el archivo del ticket de acceso queda hasta 12 horas en la carpeta de sesiones (permisos 600).
