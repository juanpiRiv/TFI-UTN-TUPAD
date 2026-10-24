# Deploy: backend y base de datos en Railway, frontend en Cloudflare

Dónde vive cada pieza, quién configura qué y los pasos para dejarlo andando. El backend y la base de datos viven juntos en un proyecto de Railway. El frontend vive en Cloudflare Pages y se publica con un workflow de GitHub Actions.

| Pieza | Dónde | Cómo se publica |
|---|---|---|
| Backend (API) | Railway, servicio `backend` | Railway lo construye desde `backend/Dockerfile` cada vez que cambia `main` |
| Base de datos | Railway, servicio PostgreSQL del mismo proyecto | Las migraciones de Prisma corren solas al arrancar el backend |
| Frontend | Cloudflare Pages, proyecto `tfi-tupad` | [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml) |

## Dónde viven los secretos

Cada secreto vive en un solo lugar, el de quien lo usa. Nunca van al repositorio (RN-14).

| Dato | Dónde | Quién lo usa |
|---|---|---|
| `DATABASE_URL` | Railway, variable del servicio `backend` | Backend |
| `JWT_SECRET` | Railway, variable del servicio `backend` | Backend |
| `CORS_ORIGIN` | Railway, variable del servicio `backend` | Backend |
| `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` | GitHub, secrets de Actions | Workflow del frontend |
| `VITE_API_URL` y `VITE_USE_MOCKS` | GitHub, variables de Actions | Build del frontend |

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
5. En Settings → Networking → Generate Domain, para tener una URL pública.
6. Invitar al resto del equipo: Project Settings → Members → invitar por correo o con un enlace.
7. Ver los logs en la pestaña Deployments del servicio. El primer arranque corre las migraciones sobre la base vacía.

## Después: conectar el frontend

1. Probar que el backend responde en su URL pública.
2. En GitHub (Settings → Secrets and variables → Actions → Variables), cargar `VITE_API_URL` con esa URL y `VITE_USE_MOCKS` con `false`.
3. Relanzar el workflow del frontend (Actions → Deploy frontend → Run workflow).
4. Probar el recorrido completo en las URLs publicadas: ingreso, cliente, movimiento, factura, pago y dashboard.

## Cosas a tener en cuenta

- El backend todavía no tiene una ruta de health. Railway lo da por vivo cuando el proceso arranca.
- Si el crédito de prueba se agota, la alternativa sin costo es el mismo Dockerfile en Render (el servicio gratuito se duerme tras 15 minutos sin uso) con la base en Supabase (conexión por el session pooler, que mantiene los bloqueos de `pg_advisory_lock`). No está configurada.
- Las variables de ARCA todavía no las lee el backend (ver [Plan B de ARCA](./06-plan-b-arca.md)).
