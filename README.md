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
Plataforma web orientada a profesionales independientes, emprendedores y pequeños comercios para centralizar la gestión financiera cotidiana, la emisión de comprobantes electrónicos y la consulta de indicadores económicos oficiales.

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
| **Infraestructura** | Cloudflare Pages (Frontend), Railway (Backend), Railway / PlanetScale (Database) |
| **Gestión** | Git, GitHub, GitHub Projects |

---

## 📁 Estructura del Repositorio

```text
├── docs/                 # Documentación e informes de entregas académicas
├── frontend/             # Código fuente de la aplicación cliente (React + TS)
├── backend/              # API REST y lógica de negocio (Node.js + Express)
├── database/             # Esquemas, migraciones y scripts de inicialización
└── README.md
```

---

## 📋 Gestión y Metodología
* **Metodología:** Kanban / Scrum
* **Seguimiento:** Tablero de tareas en [GitHub Projects](https://github.com/juanpiRiv/TFI-UTN-TUPAD/projects)
* **Control de versiones:** Gitflow (`main`, `develop`, `feature/*`, `fix/*`)

---

## 📄 Documentación de Entregas
* Los documentos formales de entrega se encuentran en la carpeta [`/docs`](./docs).
