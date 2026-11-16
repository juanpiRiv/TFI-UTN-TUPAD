# Sistema Web de Gestión Financiera y Facturación Electrónica

> **Trabajo Final Integrador (TFI)** — Tecnicatura Universitaria en Programación  
> **Universidad Tecnológica Nacional (UTN)** — Noviembre 2026  
> **Docente / Tutor:** Lic. Oscar

---

## 👥 Integrantes del Equipo
* **Rivero Albornoz, Juan Pablo**
* **Rios, Brian Emanuel**
* **Riveros Valgañón, Nahuel Nicolás**

---

## 🚀 Acceso Rápido y Entregables Principales

| Recurso | Enlace de Acceso | Descripción |
| :--- | :--- | :--- |
| **🌐 Aplicación Web (Producción)** | [https://tfi-tupad-95d.pages.dev](https://tfi-tupad-95d.pages.dev) | Frontend desplegado en **Cloudflare Pages** conectado a la API real |
| **⚙️ Backend API (Producción)** | [https://tfi-utn-tupad.onrender.com](https://tfi-utn-tupad.onrender.com) | API REST desplegada en **Render** con PostgreSQL 16 y Docker |
| **📄 Informe Final Académico (PDF)** | [docs/11-informe-final.pdf](./docs/11-informe-final.pdf) | Documento completo con portada institucional, DER, arquitectura y matriz de pruebas ([Versión Markdown](./docs/11-informe-final.md)) |
| **🎥 Video de Demostración** | [Ver Video de la Demo (YouTube / Drive)](https://github.com/juanpiRiv/TFI-UTN-TUPAD/issues/81) | Recorrido guiado de 3 a 5 minutos mostrando el flujo de punta a punta desplegado |
| **📂 Documentación del Proyecto** | [Directorio de Documentación](./docs/) | Contrato de API, DER, decisiones de diseño, concurrencia y plan de contingencia |

---

## 📌 Descripción del Proyecto

Plataforma web integral orientada a **monotributistas argentinos (prestadores de servicios y comerciantes)**, diseñada para resolver la fragmentación operativa unificando en una sola herramienta la facturación fiscal oficial y el control financiero de caja.

### 💡 Principio Contable Fundamental
El sistema diferencia de forma estricta los tres conceptos centrales de la gestión económica:
1. **Factura (`Invoice`):** Hecho fiscal ante ARCA. No ingresa dinero a la caja.
2. **Pago (`Payment`):** Extinción del crédito comercial (parcial o total) sobre una factura autorizada.
3. **Movimiento (`Transaction`):** Flujo de caja efectivo que alimenta el saldo financiero del usuario. Cada cobro genera un movimiento; la factura por sí sola no mueve dinero.

### 🌟 Funcionalidades Principales
* **Facturación Electrónica Oficial:** Emisión de Factura C ante **ARCA (ex AFIP)** mediante web services WSAA y WSFEv1. Soporta entorno de homologación real con obtención de CAE genuino y proveedor simulado para pruebas locales.
* **Comprobante Imprimible con Código QR Oficial (RG 4892):** Generación del recibo legal con datos completos de emisor y receptor, CAE, vencimiento y código QR verificable ante ARCA.
* **Seguridad de Credenciales Fiscales:** Almacén seguro con cifrado **AES-256-GCM** para claves privadas y tickets WSAA compartidos entre instancias. Asistente para generar clave y CSR sin necesidad de OpenSSL.
* **Gestión de Caja Bimonetaria:** Ingresos y egresos en pesos (ARS) y dólares (USD), con consulta automática a la cotización oficial del **Banco Central (BCRA)** y almacenamiento inmutable de la cotización histórica (`exchange_rate`).
* **Cobros Parciales y Conciliación por Adopción:** Control de sobrecobros con bloqueos pesimistas (`FOR UPDATE`). Mecanismo de adopción (`adoptTransactionId`) que permite vincular un cobro formal a un ingreso manual previo sin duplicar el dinero en el Dashboard.
* **Dashboard Financiero en Tiempo Real:** Indicadores de Facturado vs. Cobrado, Resultado de Caja y Resultado de Gestión (`facturado + ingresos manuales no conciliados − egresos`).
* **Onboarding Interactivo:** Tarjeta de primeros pasos que guía al nuevo usuario en la configuración fiscal, carga de clientes y primera emisión.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnologías |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 8, TanStack Query 5, Recharts 3 |
| **Backend** | Node.js 22, Express 5, TypeScript, Zod, Prisma ORM 7 |
| **Base de Datos** | PostgreSQL 16 (con restricciones `CHECK`, índices parciales y bloqueos transaccionales) |
| **Criptografía y Seguridad** | Argon2id (contraseñas), JWT (sesión stateless), AES-256-GCM (claves de ARCA), `@peculiar/x509` (CSR) |
| **Integraciones Oficiales** | ARCA Web Services (WSAA + WSFEv1 con `facturas@0.25.2`), APIs oficiales del BCRA (Dólar Oficial) |
| **Testing Automatizado** | Vitest, Supertest, React Testing Library (247 tests frontend y +430 tests backend en verde) |
| **Infraestructura Cloud** | Cloudflare Pages (Frontend SPA), Render (Backend Web Service Dockerizado y PostgreSQL) |
| **CI/CD** | GitHub Actions (validación automática con contenedor de PostgreSQL en cada PR) |

---

## 📁 Estructura del Repositorio

```text
├── docs/                 # Documentación técnica, informe final, DER y manuales
│   ├── 11-informe-final.pdf # Informe Final académico compilado para entrega
│   └── arca/             # Evaluaciones técnicas y evidencias reales de homologación
├── frontend/             # Código fuente de la SPA en React + Vite
│   └── src/features/     # Módulos por dominio (invoices, clients, dashboard, etc.)
├── backend/              # API REST modular en Express + TypeScript
│   ├── src/module/       # Módulos aislados (arca, auth, invoices, payments, etc.)
│   └── prisma/schema/    # Esquema relacional modular de Prisma
├── database/
│   └── schema.sql        # DDL completo de PostgreSQL generado desde las migraciones
├── scripts/              # Utilidades de desarrollo, scripts E2E y generador de PDF
├── pnpm-workspace.yaml   # Monorepo configurado con pnpm
└── README.md
```

---

## ▶️ Ejecución en Entorno Local

### Requisitos Previos
- **Node.js** 22.22 o superior
- **pnpm** 10 (`corepack enable`)
- **Docker** (para la base de datos PostgreSQL local)

### Paso a Paso

```bash
# 1. Clonar el repositorio e instalar dependencias
git clone https://github.com/juanpiRiv/TFI-UTN-TUPAD.git
cd TFI-UTN-TUPAD
pnpm install

# 2. Levantar la base de datos PostgreSQL local
cd backend
docker compose up -d

# 3. Configurar variables de entorno y aplicar migraciones
cp .env-template .env
pnpm exec prisma migrate deploy
pnpm db:seed                            # Carga usuario demo y catálogo inicial
pnpm dev                                # API disponible en http://localhost:3000

# 4. En otra terminal, iniciar el frontend (desde la raíz)
pnpm dev                                # Aplicación disponible en http://localhost:5173
```

> **Usuario de prueba (Seed):**  
> `demo@monotributo.com` / `Password123!`

---

## 📄 Mapa de Documentación

| Documento | Contenido Principal |
| :--- | :--- |
| [Informe Final Académico](./docs/11-informe-final.md) | Informe formal autocontenido con DER, arquitectura, reglas críticas y pruebas |
| [Propuesta y Alcance](./docs/01-propuesta.md) | Formulación original, justificación, alcance P0 y roadmap de evolución |
| [Atomicidad y Concurrencia](./docs/02-atomicidad-concurrencia.md) | Bloqueos pesimistas (`FOR UPDATE`), exclusión mutua en numeración fiscal y tickets |
| [Modelo de Datos](./docs/03-modelo-de-datos.md) | Diccionario de datos, restricciones de integridad e inmutabilidad de snapshots |
| [Facturación y Cobranzas](./docs/04-factura-cobro-y-pagos.md) | Reglas de negocio de pagos parciales, estados comerciales y conciliación de caja |
| [Cotizaciones y Multimoneda](./docs/05-cotizacion.md) | Integración con BCRA, series oficiales y persistencia de cotización histórica |
| [Plan B e Integración ARCA](./docs/06-plan-b-arca.md) | Decisiones técnicas ante ARCA, evidencias de homologación y plan de contingencia |
| [Relevamiento Empírico](./docs/07-relevamiento.md) | Guion de entrevistas a monotributistas reales y matriz de hallazgos confirmados |
| [Contrato de API](./docs/08-contrato-api.md) | Especificación de endpoints REST, esquemas de entrada/salida y códigos HTTP |
| [Guía de Despliegue](./docs/09-deploy.md) | Configuración de Render, Cloudflare Pages, variables de entorno y rotación de claves |
| [Diagramas y Arquitectura](./docs/10-diagramas-y-arquitectura.md) | Diagrama de Entidad-Relación (DER) y diagramas de secuencia de flujos críticos |
| [Guion de la Demo](./docs/12-guion-demo.md) | Guion estructurado para la grabación del video y la defensa oral |

---

## 🏆 Estado de Cumplimiento de Entregas

Todas las observaciones señaladas por la cátedra a lo largo de las revisiones fueron incorporadas, testeadas y desplegadas:
- **Devolución 1:** Separación relacional de Factura, Pago y Movimiento; DER normalizado; transacciones atómicas; tratamiento de multimoneda con cotización BCRA.
- **Devolución 2:** Snapshot inmutable del emisor en facturas (`issuer_*`); moneda base fijada en ARS; regla de coincidencia estricta de moneda en pagos (422); prevención de doble conteo en dashboard mediante adopción (`adoptTransactionId`); restricción de actividad primaria única.
- **Devolución 3:** Aprobación de la evaluación técnica de ARCA; emisión y consulta real en homologación de Factura C con CAE y QR verificados; recorrido vertical de punta a punta desplegado en la nube pública sin mocks de desarrollo.
