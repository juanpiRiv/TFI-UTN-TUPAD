# Sistema Web de Gestión Financiera y Facturación Electrónica

> **Trabajo Final Integrador** — Tecnicatura Universitaria en Programación  
> **Universidad Tecnológica Nacional (UTN)** — Año 2026

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

Toda la documentación se mantiene en Markdown dentro del repositorio, para poder recorrerla directamente desde GitHub.

| Documento | Contenido |
| :--- | :--- |
| [Propuesta de proyecto](./docs/01-propuesta.md) | Primera Entrega corregida: problema, alcance del MVP, stack, arquitectura, RF/RNF/RN, roadmap, riesgos y DER inicial |
| [Atomicidad y concurrencia](./docs/02-atomicidad-concurrencia.md) | Transacciones de BD, pagos concurrentes, numeración y emisión con ARCA, ticket WSAA, restricciones y pruebas |
| [Backlog](./docs/BACKLOG.md) | Tareas por fase hasta la entrega final, camino crítico y Definition of Done de la Entrega 2 |
| [Guía de contribución](./docs/CONTRIBUTING.md) | Ramas, convención de issues/PRs, labels, módulos y tablero |

La versión original de la Primera Entrega se conserva como histórico en [`docs/TFI_Primera_Entrega.pdf`](./docs/TFI_Primera_Entrega.pdf).
