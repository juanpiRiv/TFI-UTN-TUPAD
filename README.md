# Sistema Web de Gestión Financiera y Facturación Electrónica

> **Trabajo Final Integrador**, Tecnicatura Universitaria en Programación  
> **Universidad Tecnológica Nacional (UTN)**, Año 2026

---

## 👥 Integrantes del Equipo
* **Rivero Albornoz, Juan Pablo**
* **Rios, Brian Emanuel**
* **Riveros Valgañón, Nahuel Nicolás**

---

## 📌 Descripción del Proyecto
Plataforma web orientada inicialmente a **monotributistas que venden productos, prestan servicios o ambas cosas**, para centralizar la gestión financiera cotidiana, la emisión de comprobantes electrónicos y la consulta de indicadores económicos oficiales.

### Características Principales (MVP)
* **Gestión Financiera:** Registro, categorización y filtros de ingresos y egresos.
* **Facturación Electrónica:** Integración con **ARCA (ex AFIP)** mediante Web Services (WSAA + WSFEv1) en entorno de homologación para la obtención de CAE y emisión de comprobantes en PDF.
* **Multimoneda y Cotizaciones:** Soporte ARS/USD con actualización automática de cotizaciones oficiales del **BCRA**.
* **Gestión de Clientes:** Administración de clientes con historial de operaciones y cobros asociados.
* **Dashboard Interactivo:** Visualización del resultado financiero real, diferenciando facturación de cobros efectivos.
* **Notificaciones (Evolutivo):** Comunicación y envío de comprobantes vía WhatsApp mediante **Kapso**.

---

## 🛠️ Stack Tecnológico

| Área | Tecnologías |
| :--- | :--- |
| **Frontend** | React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, Recharts |
| **Backend** | Node.js, Express, TypeScript |
| **Base de Datos** | PostgreSQL, Prisma ORM |
| **Seguridad** | JWT, bcrypt / Argon2, HTTPS |
| **Integraciones** | ARCA Web Services (WSAA/WSFEv1), APIs Banco Central (BCRA), Kapso / WhatsApp |
| **Testing** | Vitest, Jest, Supertest, Postman |
| **Infraestructura** | Cloudflare Pages (Frontend), Railway (Backend), Railway / Supabase (Database) |
| **Gestión** | Git, GitHub, GitHub Projects |

---

## 📁 Estructura del Repositorio

```text
├── docs/                 # Documentación del proyecto en Markdown
│   └── img/              # Diagramas, DER y capturas enlazados desde los .md
├── frontend/             # Aplicación web (React + TS), con su propio README
├── backend/              # API REST (Node.js + Express), un módulo por carpeta en src/module/
│   └── prisma/           # Esquema de Prisma y migraciones
├── database/
│   └── schema.sql        # Esquema completo en SQL, generado desde las migraciones
├── scripts/github/       # Scripts para issues y Project Board
├── pnpm-workspace.yaml   # Workspace de pnpm con backend y frontend
└── README.md
```

---

## ▶️ Cómo levantar el proyecto

Requisitos: Node 22.22 o superior (`nvm use` toma la versión del `.nvmrc`), pnpm 10 (`corepack enable`) y Docker. El camino corto es `./scripts/dev.sh`, que prepara todo el entorno y levanta backend y frontend juntos (ver [`scripts/setup.sh`](./scripts/setup.sh) para el detalle). En Windows los scripts corren con Git Bash o WSL. El camino manual:

```bash
# 1. Dependencias de todo el workspace (también genera el cliente de Prisma)
pnpm install

# 2. Base de datos
cd backend
docker compose up -d                    # Postgres en el puerto 5433
cp .env-template .env                   # completar JWT_SECRET (openssl rand -hex 32)
pnpm exec prisma migrate deploy         # crea las tablas
pnpm dev                                # API en http://localhost:3000

# 3. Frontend, en otra terminal y desde la raíz
pnpm dev                                # app en http://localhost:5173
```

Si no se usa Prisma, la base también se puede crear con `psql -d <base> -f database/schema.sql`.

Hoy el backend tiene registro, inicio de sesión y `/me`. El resto de los endpoints se simulan en el frontend con MSW: se prenden con `VITE_USE_MOCKS=true` en `frontend/.env.local` (ver [README del frontend](./frontend/README.md#mocks)).

Controles: `pnpm lint`, `pnpm test` y `pnpm build` desde la raíz.

---

## 📋 Gestión y Metodología
* **Metodología:** Kanban / Scrum
* **Seguimiento:** Tablero [Roadmap-TUPAD](https://github.com/users/juanpiRiv/projects/9) en GitHub Projects (Status: `Todo` / `In progress` / `Done` / `Blocked`, Priority: `P0`/`P1`/`P2`)
* **Convenciones:** ver [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md)
* **Control de versiones:** Gitflow (`main`, `develop`, `feature/*`, `fix/*`)

---

## 📄 Documentación

Toda la documentación está en Markdown dentro del repo, así se puede leer directo desde GitHub sin descargar nada.

| Documento | Qué tiene |
| :--- | :--- |
| [Propuesta de proyecto](./docs/01-propuesta.md) | La primera entrega corregida: problema, alcance del MVP, stack, arquitectura, requerimientos, reglas de negocio, roadmap, riesgos y DER inicial |
| [Atomicidad y concurrencia](./docs/02-atomicidad-concurrencia.md) | Cómo evitamos datos a medias o duplicados: transacciones, pagos simultáneos, numeración con ARCA, ticket de WSAA y pruebas |
| [Modelo de datos](./docs/03-modelo-de-datos.md) | DER corregido (en Mermaid), diccionario de datos y restricciones de la base. El esquema de Prisma vive en `backend/prisma/schema/` |
| [Factura, cobro y pagos parciales](./docs/04-factura-cobro-y-pagos.md) | Reglas de factura contra cobro, estados, pagos parciales con ejemplos y resultado de gestión contra resultado de caja |
| [Cotización](./docs/05-cotizacion.md) | Qué cotización usamos para gestión (BCRA) y cuál exige ARCA para facturar en dólares |
| [Plan B de ARCA](./docs/06-plan-b-arca.md) | Fechas de control y qué pasa a P1 si la integración con ARCA se atrasa |
| [Relevamiento con usuarios](./docs/07-relevamiento.md) | Guion de entrevistas y resultados (en curso) |
| [Contrato de la API](./docs/08-contrato-api.md) | Endpoints que espera el frontend: rutas, datos que se mandan y reciben, errores y preguntas abiertas |
| [Frontend](./frontend/README.md) | Cómo levantar el frontend, variables, mocks, estructura, rutas, sesión y capturas |
| [Backlog](./docs/BACKLOG.md) | Tareas por fase hasta la entrega final y camino crítico |
| [Guía de contribución](./docs/CONTRIBUTING.md) | Ramas, convención de issues y PRs, labels, módulos y tablero |

La versión original de la primera entrega queda guardada en [`docs/TFI_Primera_Entrega.pdf`](./docs/TFI_Primera_Entrega.pdf).

## ✅ Segunda entrega (27/09)

Estado de lo que pidió la cátedra para esta revisión:

| # | Pedido | Dónde está | Estado |
| :--- | :--- | :--- | :--- |
| 1 | Relevamiento breve con usuarios reales y perfil P0 elegido | [Relevamiento](./docs/07-relevamiento.md) | En curso: guion y encuesta corta listos para monotributistas del perfil P0. Faltan las respuestas |
| 2 | Modelo ER inicial con Organization, Client, Transaction, Invoice, InvoiceItem y Payment | [Modelo de datos](./docs/03-modelo-de-datos.md), `backend/prisma/` y [`database/schema.sql`](./database/schema.sql) | Hecho. El esquema de Prisma, sus migraciones y el SQL coinciden con el documento |
| 3 | Reglas de factura contra cobro y pagos parciales | [Factura, cobro y pagos parciales](./docs/04-factura-cobro-y-pagos.md) | Hecho |
| 4 | Definición de la cotización usada | [Cotización](./docs/05-cotizacion.md) | Hecho |
| 5 | Flujo usuario, organización, cliente, movimiento y dashboard funcionando | `backend/`, [`frontend/`](./frontend/README.md) y [Contrato de la API](./docs/08-contrato-api.md) | En curso. Funciona de punta a punta en el frontend: registro e inicio de sesión contra el backend real, y organización, clientes, movimientos y dashboard simulados con MSW siguiendo el contrato de la API. En el backend están auth y el esquema; organizaciones está en desarrollo y faltan clientes, categorías, movimientos y dashboard. Capturas en el [README del frontend](./frontend/README.md#capturas) |
| 6 | Spike de homologación WSAA y WSFEv1 | [Plan B de ARCA](./docs/06-plan-b-arca.md) | Pendiente: falta el certificado de homologación |
| 7 | Qué pasa a P1 si ARCA se atrasa | [Plan B de ARCA](./docs/06-plan-b-arca.md) | Hecho |
