# Deploy: backend y base de datos en Render, frontend en Cloudflare

Dónde vive cada pieza, quién configura qué y los pasos para dejarlo andando. El backend es un servicio web de Render con su base PostgreSQL. El frontend vive en Cloudflare Pages y se publica con un workflow de GitHub Actions.

| Pieza | Dónde | Cómo se publica |
|---|---|---|
| Backend (API) | Render, servicio web `tfi-utn-tupad`: `https://tfi-utn-tupad.onrender.com` | Render lo construye desde [`backend/Dockerfile`](../backend/Dockerfile) |
| Base de datos | PostgreSQL conectada al servicio por `DATABASE_URL` | Las migraciones de Prisma corren solas al arrancar el backend |
| Frontend | Cloudflare Pages, proyecto `tfi-tupad` | [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml), en cada push a `main` |

## Estado verificado (25/10/2026)

- `GET /health` responde `200` con `{"status":"ok"}`. Los endpoints privados responden `401` sin token, y un login con credenciales falsas responde `401` (la consulta a la base se ejecuta: no es un error de conexión).
- El backend corre con `ARCA_PROVIDER=simulated`: las facturas se autorizan con el proveedor simulado y la pantalla lo avisa. No hacen falta credenciales de ARCA.
- **El servicio gratuito se duerme** tras un rato sin uso: el primer pedido tardó unos 30 segundos en despertarlo. Conviene abrirlo un par de minutos antes de la demo.
- La base **no tiene los datos de prueba** (el usuario `demo@monotributo.com` no existe). Para la demo hay que cargarlos (ver más abajo) o registrar un usuario nuevo.
- **CORS:** el backend no devolvió el encabezado `Access-Control-Allow-Origin` para `https://tfi-tupad.pages.dev`, así que el navegador va a bloquear los pedidos del sitio hasta que `CORS_ORIGIN` lo incluya (ver las variables).

## Dónde viven los secretos

Cada secreto vive en un solo lugar, el de quien lo usa. Nunca van al repositorio (RN-14).

### Backend (variables del servicio en Render)

| Variable | Qué es | Cómo se carga | ¿La lee hoy el backend? |
|---|---|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL | La URL de la base (en Render, la interna si el servicio y la base están en la misma región) | Sí |
| `JWT_SECRET` | Firma de los tokens de sesión, 32 caracteres o más | Generarlo con `openssl rand -hex 32` | Sí |
| `CORS_ORIGIN` | Orígenes permitidos, separados por coma | `https://tfi-tupad.pages.dev` (y `http://localhost:5173` si se quiere probar el frontend local contra esta API) | Sí |
| `PORT` | Puerto de la API | Lo inyecta Render, no se carga | Sí |
| `NODE_ENV` | Ambiente | Lo fija el Dockerfile en `production`, no se carga | Sí |
| `ARCA_MODE` | `homologacion` (por defecto) o `produccion` | Variable normal, opcional | Sí |
| `ARCA_PROVIDER` | Qué proveedor fiscal se usa: `simulated`, `sdk` o `direct` | Variable normal. **Obligatoria**: sin ella el backend no arranca. Usar `simulated` hasta tener la emisión real | Sí |
| `ARCA_ENCRYPTION_KEY` | Clave que cifra en la base la clave privada de cada organización | Generarla con `openssl rand -hex 32`. Es un secreto | No: todavía no se usa |

`ARCA_PROVIDER` hay que cargarla desde el primer despliegue, porque el backend la valida al arrancar. `ARCA_ENCRYPTION_KEY` se carga cuando se guarden credenciales por organización; cargarla antes no hace daño.

### Credenciales de ARCA: no son variables

El certificado y la clave privada de ARCA no se cargan en Render ni en GitHub. Según el [modelo de datos](./03-modelo-de-datos.md), se guardan por organización y ambiente en la tabla `ArcaCredential`: el certificado y la clave privada cifrada con `ARCA_ENCRYPTION_KEY`, más el ticket de acceso de WSAA. Todavía no hay una pantalla ni un endpoint para cargarlos.

Hoy el certificado de homologación vive solo en la computadora del titular del CUIT, fuera del repositorio, y no hay que subirlo a ningún lado. Si se pierde `ARCA_ENCRYPTION_KEY`, las claves cifradas en la base no se pueden recuperar, así que conviene guardarla también en un gestor de contraseñas.

### Frontend y publicación (secrets y variables de GitHub Actions)

| Dato | Tipo | Quién lo usa |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | Workflow del frontend |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Workflow del frontend |
| `CLOUDFLARE_PAGES_PROJECT` | Variable (opcional, por defecto `tfi-tupad`) | Workflow del frontend |
| `VITE_API_URL` | Variable: `https://tfi-utn-tupad.onrender.com` | Build del frontend |
| `VITE_MOCK_MODULES` | Variable (vacía = usa la API real; es lo normal) | Build del frontend |

Las variables `VITE_*` quedan incluidas en el sitio publicado y las ve cualquiera: no pueden ser secretos.

El backend no usa secrets de GitHub: Render se conecta al repositorio y construye por su cuenta.

## Cómo está armado en Render

Lo creó Brian, dueño de la cuenta. Estos son los datos que hay que saber para repetirlo o revisarlo (los nombres exactos de los campos pueden variar en el panel):

1. **Base:** crear un PostgreSQL en Render y copiar su URL de conexión.
2. **Servicio web:** conectar el repositorio `juanpiRiv/TFI-UTN-TUPAD`, rama `main`, con ejecución por Docker. El `Dockerfile` es `backend/Dockerfile` y el contexto de build es la **raíz del repositorio** (el Dockerfile necesita el lockfile y los `package.json` de todo el workspace de pnpm).
3. **Health check:** la ruta `/health`.
4. **Variables:** las de la tabla de arriba. El primer arranque corre las migraciones sobre la base vacía.
5. **Logs:** pestaña Logs del servicio.

## Después: conectar el frontend

1. Probar que el backend responde en su URL pública (`/health`).
2. Confirmar que `CORS_ORIGIN` incluye `https://tfi-tupad.pages.dev`.
3. En GitHub (Settings → Secrets and variables → Actions → Variables), cargar `VITE_API_URL` con la URL del backend. `VITE_MOCK_MODULES` se deja sin definir, para que el sitio use la API real.
4. Relanzar el workflow del frontend (Actions → Deploy frontend → Run workflow): las variables `VITE_*` se incorporan al construir el sitio, no al leerlo, así que cambiarlas exige volver a publicar.
5. Probar el recorrido completo en las URLs publicadas: ingreso, cliente, movimiento, factura, pago y dashboard.

## Cargar los datos de prueba en la base de Render

El seed crea el usuario `demo@monotributo.com`, una organización con punto de venta y facturas de ejemplo. Se corre desde una computadora con la **URL externa** de la base:

```bash
cd backend
DATABASE_URL="<url externa de la base>" pnpm db:seed
```

Es idempotente, pero escribe en la base de la demo: conviene correrlo una sola vez y antes de grabar el video.

## Cosas a tener en cuenta

- El servicio gratuito se duerme tras un rato sin uso y el primer pedido tarda unos 30 segundos (ver arriba).
- La base gratuita de Render puede vencer: revisar el plan y la fecha antes de la defensa.
- [`railway.toml`](../railway.toml) quedó sin uso: se evaluó Railway primero, pero el backend se desplegó en Render. Se puede borrar.
- El backend lee `ARCA_PROVIDER` y `ARCA_MODE`, pero todavía nada emite comprobantes reales (ver [Plan B de ARCA](./06-plan-b-arca.md)).
