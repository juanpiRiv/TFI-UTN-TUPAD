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
├── frontend/             # Código fuente de la aplicación cliente (React + TS)
├── backend/              # API REST y lógica de negocio (Node.js + Express)
├── database/             # Esquemas, migraciones y scripts de inicialización
├── scripts/github/       # Scripts para issues y Project Board
└── README.md
```

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
| [Modelo de datos](./docs/03-modelo-de-datos.md) | DER corregido (en Mermaid) y diccionario de datos. El esquema de Prisma está en [`backend/prisma/schema.prisma`](./backend/prisma/schema.prisma) |
| [Factura, cobro y pagos parciales](./docs/04-factura-cobro-y-pagos.md) | Reglas de factura contra cobro, estados, pagos parciales con ejemplos y resultado de gestión contra resultado de caja |
| [Cotización](./docs/05-cotizacion.md) | Qué cotización usamos para gestión (BCRA) y cuál exige ARCA para facturar en dólares |
| [Plan B de ARCA](./docs/06-plan-b-arca.md) | Fechas de control y qué pasa a P1 si la integración con ARCA se atrasa |
| [Relevamiento con usuarios](./docs/07-relevamiento.md) | Guion de entrevistas y resultados (en curso) |
| [Backlog](./docs/BACKLOG.md) | Tareas por fase hasta la entrega final y camino crítico |
| [Guía de contribución](./docs/CONTRIBUTING.md) | Ramas, convención de issues y PRs, labels, módulos y tablero |

La versión original de la primera entrega queda guardada en [`docs/TFI_Primera_Entrega.pdf`](./docs/TFI_Primera_Entrega.pdf).

## ✅ Segunda entrega (27/09)

Estado de lo que pidió la cátedra para esta revisión:

| # | Pedido | Dónde está | Estado |
| :--- | :--- | :--- | :--- |
| 1 | Relevamiento breve con usuarios reales y perfil P0 elegido | [Relevamiento](./docs/07-relevamiento.md) | En curso: guion listo, faltan las entrevistas |
| 2 | Modelo ER inicial con Organization, Client, Transaction, Invoice, InvoiceItem y Payment | [Modelo de datos](./docs/03-modelo-de-datos.md) y [`schema.prisma`](./backend/prisma/schema.prisma) | Hecho |
| 3 | Reglas de factura contra cobro y pagos parciales | [Factura, cobro y pagos parciales](./docs/04-factura-cobro-y-pagos.md) | Hecho |
| 4 | Definición de la cotización usada | [Cotización](./docs/05-cotizacion.md) | Hecho |
| 5 | Flujo usuario, organización, cliente, movimiento y dashboard funcionando | `backend/` y `frontend/` | Pendiente |
| 6 | Spike de homologación WSAA y WSFEv1 | | Pendiente |
| 7 | Qué pasa a P1 si ARCA se atrasa | [Plan B de ARCA](./docs/06-plan-b-arca.md) | Hecho |
