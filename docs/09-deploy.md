# Deploy: backend y base de datos en Render, frontend en Cloudflare

Dónde vive cada pieza, quién configura qué y los pasos para dejarlo andando. El backend es un servicio web de Render con su base PostgreSQL. El frontend vive en Cloudflare Pages y se publica con un workflow de GitHub Actions.

| Pieza | Dónde | Cómo se publica |
|---|---|---|
| Backend (API) | Render, servicio web `tfi-utn-tupad`: `https://tfi-utn-tupad.onrender.com` | Render lo construye desde [`backend/Dockerfile`](../backend/Dockerfile) |
| Base de datos | PostgreSQL conectada al servicio por `DATABASE_URL` | Las migraciones de Prisma corren solas al arrancar el backend |
| Frontend | Cloudflare Pages, proyecto `tfi-tupad`: `https://tfi-tupad-95d.pages.dev` | [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml), en cada push a `main` |

## Estado verificado (25/10/2026)

- **Backend (Render):** `GET /health` responde `200` con `{"status":"ok"}`. Los endpoints privados responden `401` sin token, y un login con credenciales falsas responde `401` (la consulta a la base se ejecuta: no es un error de conexión). Corre con `ARCA_PROVIDER=simulated`: las facturas se autorizan con el proveedor simulado y la pantalla lo avisa. No hacen falta credenciales de ARCA.
- **Frontend (Cloudflare Pages):** publicado en `https://tfi-tupad-95d.pages.dev` (responde `200`, y la URL del backend quedó incluida en el sitio). **La dirección no es `tfi-tupad.pages.dev`**: ese nombre ya lo tiene otra cuenta de Cloudflare, así que Pages le agregó un sufijo al crear el proyecto en la cuenta de los secrets.
- **El servicio gratuito de Render se duerme** tras un rato sin uso: el primer pedido tardó unos 30 segundos en despertarlo. Conviene abrirlo un par de minutos antes de la demo.
- La base **no tiene los datos de prueba** (el usuario `demo@monotributo.com` no existe). Para la demo hay que cargarlos (ver más abajo) o registrar un usuario nuevo.
- **CORS:** hoy el backend le contesta a cualquier origen (devuelve el origen que le llega). Funciona con el sitio, pero conviene dejar `CORS_ORIGIN=https://tfi-tupad-95d.pages.dev` para que solo ese sitio pueda usar la API desde un navegador.
- **Lo que falta verificar:** el recorrido completo desde el navegador (ingreso, cliente, factura, cobro y dashboard) sobre el sitio publicado.

## Dónde viven los secretos

Cada secreto vive en un solo lugar, el de quien lo usa. Nunca van al repositorio (RN-14).

### Backend (variables del servicio en Render)

| Variable | Qué es | Cómo se carga | ¿La lee hoy el backend? |
|---|---|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL | La URL de la base (en Render, la interna si el servicio y la base están en la misma región) | Sí |
| `JWT_SECRET` | Firma de los tokens de sesión, 32 caracteres o más | Generarlo con `openssl rand -hex 32` | Sí |
| `CORS_ORIGIN` | Orígenes permitidos, separados por coma | `https://tfi-tupad-95d.pages.dev` (y `http://localhost:5173` si se quiere probar el frontend local contra esta API) | Sí |
| `PORT` | Puerto de la API | Lo inyecta Render, no se carga | Sí |
| `NODE_ENV` | Ambiente | Lo fija el Dockerfile en `production`, no se carga | Sí |
| `ARCA_MODE` | `homologacion` (por defecto) o `produccion` | Variable normal, opcional | Sí |
| `ARCA_PROVIDER` | Qué proveedor fiscal se usa: `simulated`, `sdk` o `direct` | Variable normal. **Obligatoria**: sin ella el backend no arranca. Usar `simulated` hasta tener la emisión real | Sí |
| `ARCA_ENCRYPTION_KEY` | Clave que cifra en la base la clave privada de cada organización | Generarla con `openssl rand -hex 32`. Es un secreto | Sí: la lee el backend (cifra la clave privada y el ticket de WSAA) |

`ARCA_PROVIDER` hay que cargarla desde el primer despliegue, porque el backend la valida al arrancar. `ARCA_ENCRYPTION_KEY` hay que cargarla antes de que una organización guarde su credencial.

### Credenciales de ARCA: no son variables

El certificado y la clave privada de ARCA no se cargan en Render ni en GitHub. Según el [modelo de datos](./03-modelo-de-datos.md), se guardan por organización y ambiente en la tabla `ArcaCredential`: el certificado y la clave privada cifrada con `ARCA_ENCRYPTION_KEY`, más el ticket de acceso de WSAA. Se cargan desde la pantalla de la organización o con `POST /api/organizations/me/arca-credential`.

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
2. Confirmar que `CORS_ORIGIN` incluye `https://tfi-tupad-95d.pages.dev`.
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
- Se evaluó Railway primero, pero el backend se desplegó en Render; el `railway.toml` que quedó sin uso se eliminó.
- El backend lee `ARCA_PROVIDER` y `ARCA_MODE`. En producción sigue configurado `ARCA_PROVIDER=simulated` para la demo sin validez fiscal, pero el proveedor `sdk` ya se encuentra implementado y verificado en homologación (ver [Plan B de ARCA](./06-plan-b-arca.md)).

## ARCA en homologación

La facturación contra ARCA se prueba solo en homologación (`ARCA_MODE=homologacion`). Con `ARCA_PROVIDER=sdk`, producción queda bloqueada salvo que se escriba `ARCA_ALLOW_PRODUCTION=true`, y no hace falta en este proyecto.

**Variables del backend**

| Variable | Para qué sirve |
| --- | --- |
| `ARCA_PROVIDER` | `simulated` (demo, sin validez fiscal) o `sdk` (ARCA de verdad). Obligatoria. |
| `ARCA_MODE` | `homologacion` por defecto. |
| `ARCA_ENCRYPTION_KEY` | 64 caracteres hexadecimales (`openssl rand -hex 32`). Cifra la clave privada que cada organización carga. Si se pierde, hay que volver a cargar las credenciales. |
| `ARCA_CUIT`, `ARCA_CERT_PATH` y `ARCA_KEY_PATH` (o `ARCA_CERT_PEM` y `ARCA_KEY_PEM`) | Credenciales de la plataforma. Sin modo delegado sirven solo para desarrollo: se usan únicamente para la organización cuyo CUIT es el de `ARCA_CUIT`, nunca para otra. Con `ARCA_DELEGATION=true` son el certificado con el que se firma en nombre de los clientes. |
| `ARCA_DELEGATION` | `true` habilita el **modo delegado**: la plataforma firma con un solo certificado (el de `ARCA_CUIT` y las variables `ARCA_CERT_*`/`ARCA_KEY_*`, con `ARCA_PROVIDER=sdk`) y emite en nombre de cada cliente que le delegó el servicio de facturación en ARCA. Sin la variable, o con otro valor, no cambia nada y los endpoints de delegación responden que no está disponible. En producción hace falta además `ARCA_ALLOW_PRODUCTION=true`. Las credenciales de ese certificado son un secreto de la plataforma: se cargan como variables del servidor, nunca en el repositorio. |
| `ARCA_PLATFORM_OWNER_EMAILS` | Opcional. Correos separados por coma de quienes pueden registrar una organización con el CUIT de la plataforma (`ARCA_CUIT`) y operar con él. Vacía = nadie. Si no existe esta lista, cualquier usuario podría registrar ese CUIT y emitir con el certificado de la plataforma, por eso el backend lo rechaza con el mismo error que un CUIT ocupado cuando las variables `ARCA_*` firman (proveedor `sdk` o modo delegado). En `NODE_ENV=production`, el camino de variables con el mismo CUIT solo sirve a un usuario de esta lista; en desarrollo y test no se exige. |
| `ARCA_SESSION_DIR` | Solo para el almacén en archivo (sin base de datos): carpeta donde se comparte el ticket de acceso de WSAA entre procesos. Por defecto `~/.arca-homologacion/sessions`. |

### Límite conocido de la delegación

La verificación de la delegación prueba que **alguien** delegó el servicio de facturación de ese CUIT a la plataforma; **no prueba que quien la pide sea el dueño del CUIT**. Un tercero que registre en la aplicación el CUIT de un cliente que ya delegó a la plataforma, antes que el cliente, podría verificar y facturar a su nombre. Defensas que ya existen: el CUIT de la plataforma no se puede registrar (salvo `ARCA_PLATFORM_OWNER_EMAILS`), cambiar el CUIT de una organización borra su delegación, y verificar tiene límite de pedidos. Mitigaciones posibles, todavía sin implementar: validar la razón social contra el padrón de ARCA, aprobación manual de cada alta, o verificar el correo del titular. Hasta entonces, conviene habilitar el modo delegado solo para clientes conocidos.

**El ticket de acceso.** ARCA entrega un ticket de WSAA que dura 12 horas y no da otro mientras ese siga vigente: responde `coe.alreadyAuthenticated`. Por eso todas las instancias tienen que compartir el mismo ticket. El backend lo guarda en la tabla `arca_wsaa_tickets` de PostgreSQL, con el token y la firma cifrados con `ARCA_ENCRYPTION_KEY` (AES-256-GCM), y usa un bloqueo asesor de PostgreSQL para que, si varias instancias lo necesitan a la vez, solo una lo pida a ARCA y las demás reutilicen el resultado. Esto permite correr más de una instancia en Render, incluso con disco efímero. Si un ticket guardado no se puede descifrar con la clave de esa instancia (por ejemplo, durante una rotación), esa instancia lo ignora pero no lo borra: lo puede leer otra con la clave correcta. Cada proceso toma como máximo 3 bloqueos a la vez para no agotar las conexiones de la base.

Cuando no hay base de datos o falta `ARCA_ENCRYPTION_KEY` (desarrollo y scripts como `arca:smoke`), se usa en cambio un archivo con permisos 600 en `ARCA_SESSION_DIR`, que alcanza con una sola máquina. El ticket de una credencial borrada o reemplazada no se limpia de inmediato: queda inutilizable y vence solo en 12 horas como máximo.

**Rotar `ARCA_ENCRYPTION_KEY`.** Conviene hacerlo si la clave se filtró o por política. Desde `backend/`, con la base de producción en `DATABASE_URL`:

1. Hacer un backup de la base.
2. Generar la clave nueva: `openssl rand -hex 32`.
3. Simular (no escribe nada): `ARCA_OLD_ENCRYPTION_KEY=<vieja> ARCA_NEW_ENCRYPTION_KEY=<nueva> pnpm arca:rotate-key`.
4. Aplicar: el mismo comando con `--apply`. Vuelve a cifrar las claves privadas, las claves de las solicitudes de certificado pendientes (tabla `arca_csr_requests`) y los tickets de WSAA vigentes en una sola transacción: si una credencial no se descifra ni con la clave vieja ni con la nueva, no cambia nada. Las solicitudes pendientes y los tickets ilegibles no frenan la rotación: se descartan y se informan (el cliente puede generar otra solicitud). Se puede repetir sin riesgo.
5. Cambiar `ARCA_ENCRYPTION_KEY` en el servidor por la clave nueva y reiniciar.

Si alguien guarda una credencial mientras se rota, la rotación aborta sin cambiar nada y hay que repetirla. Entre los pasos 4 y 5 el servidor con la clave vieja no puede descifrar las credenciales y las emisiones por ARCA fallan con un error claro: conviene hacerlo en una ventana corta. Las claves se pasan por variables de entorno y el script imprime solo cantidades.

**Credencial por organización.** El cliente conecta su cuenta en la pantalla de la organización (`/organizacion`): la aplicación genera la clave y el CSR, y él solo sube el certificado que le devuelve ARCA (también puede cargar un certificado y una clave propios). Los pasos que hace antes en ARCA están en [la guía del cliente](./arca/alta-de-cliente.md).

**Chequeos locales** (desde `backend/`, con las variables ARCA_* cargadas):

- `pnpm arca:smoke 1,2`: autentica en el WSAA, consulta el próximo número de Factura C de cada punto de venta y el catálogo de condiciones de IVA. No emite nada.
- `pnpm arca:e2e 1,2`: con el backend local levantado, crea un usuario y una organización de prueba y emite una Factura C de $ 1500 por punto de venta. Con `E2E_UPLOAD_CREDENTIAL=true` carga antes el certificado y la clave por la API, como lo haría un cliente.

**GitHub Actions.** El CI normal (`ci.yml`) usa el proveedor simulado y no necesita secretos. Hay un workflow aparte y manual, `arca-homologacion.yml`, que corre el chequeo de solo lectura. Para usarlo hay que crear el environment `arca-homologacion` con un **revisor obligatorio** y **restringir sus ramas de despliegue a `develop`** (Settings > Environments > Deployment branches): ese es el control real, porque el `if` del workflow se puede editar en otra rama. Los secrets son `ARCA_CUIT`, `ARCA_CERT_PEM` y `ARCA_KEY_PEM`, y solo los ve el paso que corre el chequeo. Corre una vez a la vez y no guarda el ticket en ningún cache.

**Límite conocido:** como el ticket no se guarda, una segunda corrida dentro de las 12 horas con el mismo certificado falla con `coe.alreadyAuthenticated`, igual que si otra máquina lo estuviera usando. Por eso conviene un **certificado exclusivo para el CI**, distinto al de desarrollo: dos certificados distintos no se pisan el ticket.

Al borrar o reemplazar una credencial de organización, el cliente guardado en memoria se descarta, pero el archivo del ticket de acceso queda hasta 12 horas en la carpeta de sesiones (permisos 600).

