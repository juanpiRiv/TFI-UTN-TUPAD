# Frontend

Aplicación web del TFI: React 19, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form con Zod y Recharts.

Cubre el recorrido de la segunda entrega: registro e inicio de sesión, onboarding de la organización, clientes, categorías, movimientos y dashboard.

## Requisitos

- Node 22.22 o superior. React Router 8 no funciona con versiones anteriores. En la raíz del repo hay un `.nvmrc`, así que alcanza con `nvm use`.
- pnpm 10.33, la misma versión que usa el backend. Si tenés Corepack activado (`corepack enable`), se instala solo al correr cualquier comando.
- El backend corriendo, para registrarse e iniciar sesión (ver `backend/`).

## Cómo levantarlo

Desde la raíz del repo:

```bash
pnpm install
pnpm dev
```

La app queda en http://localhost:5173. Por defecto se conecta de forma directa a la API en `http://localhost:3000`. Si se desea aislar o simular módulos específicos con MSW, se configura `frontend/.env.local`:

```text
VITE_API_URL=http://localhost:3000
# Opcional: lista separada por comas de módulos a simular con MSW (ej: categories, organizations, o all)
# VITE_MOCK_MODULES=categories,organizations
```

Otros comandos, también desde la raíz (o desde `frontend/` sin el filtro):

| Comando                         | Qué hace                                                  |
| ------------------------------- | --------------------------------------------------------- |
| `pnpm lint`                     | ESLint                                                    |
| `pnpm test`                     | Tests con Vitest                                          |
| `pnpm build`                    | Chequeo de tipos y build de producción en `frontend/dist` |
| `pnpm --filter frontend format` | Formatea con Prettier                                     |

## Variables de entorno

| Variable            | Default                 | Para qué                                                                                          |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`      | `http://localhost:3000` | URL del backend, sin `/api` al final.                                                             |
| `VITE_MOCK_MODULES` | vacío                   | Lista separada por comas de módulos a simular con MSW. Vacío = consumo directo del backend real. |

Las variables `VITE_*` quedan dentro del bundle que se publica, así que nunca pongas ahí secretos.

## Mocks

Todos los módulos cuentan con su implementación en el backend real. Para desarrollo desacoplado o testing puntual, se puede activar la simulación por módulo con `VITE_MOCK_MODULES` (por ejemplo: `VITE_MOCK_MODULES=categories,organizations` o `all`).

- Si `VITE_MOCK_MODULES` está vacío o no se define, MSW **no** se inicializa en el navegador y el bundle no carga los handlers de mocks.
- Módulos soportados: `organizations` (incluye `me-overlay` para mantener sincronizada la organización activa), `categories`, `clients`, `transactions`, `dashboard`, `exchange-rates`.
- Los datos simulados se guardan en el `localStorage` del navegador (`tfi.mocks.db`), así sobreviven a una recarga. Para empezar de cero, borrá esa clave.
- Las pantallas y los `features/*/api.ts` llaman a la misma URL en ambos casos de forma agnóstica.
- Los tests en Vitest (`src/test/setup.ts`) usan los handlers de `src/mocks/node.ts` para ejecutar pruebas unitarias y de integración de interfaz sin requerir que el backend esté levantado.

## Estructura

```text
src/
├── app/            router, guardas de rutas, QueryClient y layout con la navegación
├── features/       un módulo por carpeta, con los mismos nombres que el backend
│   ├── auth/           registro, login y sesión
│   ├── organizations/  onboarding y "Mi negocio"
│   ├── clients/
│   ├── categories/
│   ├── transactions/
│   └── dashboard/
├── components/ui/  botón, input, select, tabla, modal y estados de carga, vacío y error
├── lib/            cliente HTTP, sesión y formato de moneda y fecha
├── mocks/          handlers de MSW y datos simulados
└── test/           setup de Vitest y helpers
```

Cada módulo de `features/` tiene:

- `api.ts`: las llamadas a la API, sin nada de React.
- `queries.ts`: los hooks de TanStack Query y la fábrica de query keys del módulo. Cada mutación invalida las keys que afecta.
- `schemas.ts`: los tipos y los esquemas de Zod de los formularios.
- Las páginas y los componentes del módulo.

## Rutas

| Ruta                                                             | Acceso                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/login`, `/registro`                                            | Públicas. Si ya hay sesión, redirigen a la app.                  |
| `/onboarding`                                                    | Solo para usuarios logueados que todavía no tienen organización. |
| `/`, `/movimientos`, `/clientes`, `/categorias`, `/organizacion` | Usuarios logueados con organización.                             |

Las guardas son loaders de React Router (`src/app/guards.ts`). Consultan `GET /api/auth/me`: sin token mandan al login, y si `organization` viene en `null` mandan a `/onboarding`. Cada página se carga de forma diferida, y Recharts viaja solo en el chunk del dashboard.

## Sesión

- El backend devuelve el JWT en el cuerpo de la respuesta. Lo guardamos en memoria y en `localStorage`, para que la sesión sobreviva a una recarga.
- Al abrir la app, la guarda valida el token con `GET /api/auth/me`.
- `src/lib/api.ts` agrega `Authorization: Bearer <token>` a cada pedido. Si un pedido con token recibe un `401`, cierra la sesión y vuelve al login.
- Cerrar sesión borra el token y limpia toda la caché de TanStack Query.

**Pendiente:** guardar el token en `localStorage` lo deja expuesto si alguna vez entra un script malicioso (XSS). Más adelante conviene pasarlo a una cookie `httpOnly`, `Secure` y `SameSite`. Eso requiere cambios en el backend: que el login setee la cookie, que el middleware la lea, un endpoint de logout y CORS con `credentials`.

## Reglas de negocio en el front

- Los importes llegan como string decimal (`"1500.50"`). El front los formatea para mostrarlos, pero no suma ni convierte plata: los totales los calcula el backend (o el mock).
- Movimientos: importe mayor a cero, moneda obligatoria y categoría del mismo tipo que el movimiento. Si la moneda no es la base, se pide el tipo de cambio. Para dólares se sugiere la cotización del día y se puede editar.
- Clientes: la baja es lógica. Los clientes dados de baja se ocultan por defecto y se ven con el filtro "Mostrar dados de baja".

## Despliegue

`public/_redirects` le indica a Cloudflare Pages que sirva `index.html` en cualquier ruta, así no da 404 al recargar `/movimientos`.

## Capturas

|                                                                                   |                                                                                                 |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ![Login con el error del backend](../docs/img/frontend/01-login.png)              | ![Onboarding](../docs/img/frontend/02-onboarding.png)                                           |
| ![Clientes con uno dado de baja](../docs/img/frontend/03-clientes.png)            | ![Movimiento en dólares con la cotización sugerida](../docs/img/frontend/04-movimiento-usd.png) |
| ![Movimientos](../docs/img/frontend/05-movimientos.png)                           | ![Movimientos filtrados por egreso](../docs/img/frontend/06-movimientos-filtro-egresos.png)      |
| ![Dashboard](../docs/img/frontend/07-dashboard.png)                               | ![Categorías](../docs/img/frontend/08-categorias.png)                                           |
| ![Alta de movimiento en el celular](../docs/img/frontend/09-movil-movimiento.png) | ![Dashboard en el celular](../docs/img/frontend/10-movil-dashboard.png)                         |
