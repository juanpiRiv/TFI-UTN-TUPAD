# Diagramas Finales y Arquitectura del Sistema

Este documento da cumplimiento al requerimiento **F10-4 (Issue #79: docs(der): armar los diagramas finales)** del proyecto. Reúne el Diagrama de Entidad-Relación (DER) con las tablas y columnas del esquema de Prisma (`backend/prisma/schema/`), el diagrama de arquitectura y los diagramas de secuencia de dos flujos críticos.

Qué parte está implementada:
- El DER coincide, tabla por tabla y columna por columna, con el esquema de Prisma. Lo que aparece en el esquema no siempre tiene pantalla o endpoint (por ejemplo, `PASSWORD_RESET_TOKEN`, `ACTIVITY` y `ARCA_CREDENTIAL` existen como tablas, pero todavía no hay recuperación de contraseña ni carga de actividades o credenciales).
- Los dos flujos de secuencia están implementados. El de facturar funciona con el proveedor fiscal simulado.

---

## 1. Diagrama de Entidad-Relación (DER) Final

El siguiente diagrama refleja la estructura de datos implementada en PostgreSQL a través de Prisma ORM (`backend/prisma/schema/*.prisma`).

```mermaid
erDiagram
    USER ||--o| ORGANIZATION : "administra (1:1)"
    USER ||--o{ PASSWORD_RESET_TOKEN : "solicita (1:N)"
    USER |o--o{ AUDIT_LOG : "ejecuta (1:N)"
    
    ORGANIZATION ||--o{ ARCA_CREDENTIAL : "configura (1:N)"
    ORGANIZATION ||--o{ ACTIVITY : "desarrolla (1:N)"
    ORGANIZATION ||--o{ POINT_OF_SALE : "habilita (1:N)"
    ORGANIZATION ||--o{ CLIENT : "atiende (1:N)"
    ORGANIZATION ||--o{ CATEGORY : "clasifica con (1:N)"
    ORGANIZATION ||--o{ TRANSACTION : "registra en caja (1:N)"
    ORGANIZATION ||--o{ INVOICE : "emite (1:N)"
    ORGANIZATION |o--o{ AUDIT_LOG : "genera (1:N)"

    POINT_OF_SALE ||--o{ INVOICE : "numera fiscalmente (1:N)"
    CLIENT |o--o{ INVOICE : "recibe comprobante (1:N)"
    CLIENT |o--o{ TRANSACTION : "asociado a (1:N)"
    
    INVOICE |o--o{ INVOICE : "comprobante asociado (NC/ND)"
    INVOICE ||--|{ INVOICE_ITEM : "contiene ítems (1:N)"
    INVOICE ||--o{ PAYMENT : "se cobra mediante (1:N)"
    
    PAYMENT ||--o| TRANSACTION : "genera o adopta (1:1)"
    CATEGORY ||--o{ TRANSACTION : "tipifica movimiento (1:N)"

    USER {
        int id PK
        string email UK
        string password_hash
        string name
        datetime created_at
        datetime updated_at
    }

    PASSWORD_RESET_TOKEN {
        int id PK
        int user_id FK
        string token_hash UK
        datetime expires_at
        datetime used_at
        datetime created_at
    }

    ORGANIZATION {
        int id PK
        int user_id FK "UK"
        string cuit UK
        string legal_name
        string trade_name
        string commercial_address
        enum tax_condition "MONOTRIBUTO en el P0"
        string monotributo_category
        date activity_start_date
        string gross_income_number
        enum base_currency "ARS"
        bool is_active
        datetime created_at
        datetime updated_at
    }

    ARCA_CREDENTIAL {
        int id PK
        int organization_id FK
        enum environment "HOMOLOGACION | PRODUCCION"
        string service "wsfe"
        text certificate
        text private_key_encrypted
        text token
        text sign
        datetime token_expires_at
        datetime created_at
        datetime updated_at
    }

    ACTIVITY {
        int id PK
        int organization_id FK
        string arca_activity_code
        string description
        enum activity_kind "GOODS | SERVICES"
        bool is_primary
        bool is_active
        datetime created_at
        datetime updated_at
    }

    POINT_OF_SALE {
        int id PK
        int organization_id FK
        int number
        enum billing_method "CAE"
        string address
        bool is_active
        datetime created_at
        datetime updated_at
    }

    CLIENT {
        int id PK
        int organization_id FK
        enum doc_type "CUIT | CUIL | DNI | PASAPORTE | SIN_IDENTIFICAR"
        string doc_number
        string name
        string address
        enum tax_condition "RESPONSABLE_INSCRIPTO | MONOTRIBUTO | EXENTO | CONSUMIDOR_FINAL"
        string email
        string phone
        bool is_active
        datetime created_at
        datetime updated_at
    }

    CATEGORY {
        int id PK
        int organization_id FK
        string name
        enum type "INCOME | EXPENSE"
        bool is_active
        datetime created_at
        datetime updated_at
    }

    EXCHANGE_RATE {
        int id PK
        string source "BCRA"
        string rate_type "ESTADISTICAS_CAMBIARIAS"
        enum from_currency "USD"
        enum to_currency "ARS"
        decimal value "18,6"
        date observed_at
        datetime created_at
        datetime updated_at
    }

    INVOICE {
        int id PK
        int organization_id FK
        int point_of_sale_id FK
        int client_id FK
        int associated_invoice_id FK
        enum voucher_type "FACTURA_C | NOTA_CREDITO_C | NOTA_DEBITO_C"
        int voucher_number
        enum concept "PRODUCTOS | SERVICIOS | PRODUCTOS_Y_SERVICIOS"
        date issue_date
        enum recipient_doc_type
        string recipient_doc_number
        string recipient_name
        string recipient_address
        enum recipient_tax_condition
        enum currency "ARS | USD"
        decimal fiscal_exchange_rate "18,6"
        date service_from
        date service_to
        date payment_due_date
        decimal total_amount "18,2"
        enum status "DRAFT | PENDING | AUTHORIZED | REJECTED"
        string cae
        date cae_expiration
        json arca_response
        datetime authorized_at
        datetime created_at
        datetime updated_at
    }

    INVOICE_ITEM {
        int id PK
        int invoice_id FK
        string description
        decimal quantity "18,3"
        decimal unit_price "18,2"
        decimal subtotal "18,2"
    }

    PAYMENT {
        int id PK
        int invoice_id FK
        decimal amount "18,2"
        enum currency "ARS | USD"
        decimal exchange_rate "18,6"
        date payment_date
        datetime voided_at
        datetime created_at
        datetime updated_at
    }

    TRANSACTION {
        int id PK
        int organization_id FK
        int payment_id FK "UK"
        int category_id FK
        int client_id FK
        enum type "INCOME | EXPENSE"
        decimal amount "18,2"
        enum currency "ARS | USD"
        decimal exchange_rate "18,6"
        date transaction_date
        string description
        datetime voided_at
        datetime created_at
        datetime updated_at
    }

    AUDIT_LOG {
        int id PK
        int organization_id FK
        int user_id FK
        string action
        string entity
        int entity_id
        json metadata
        string ip_address
        datetime created_at
    }
```

### Características Clave del Modelo de Datos
1. **Multi-tenancy Fuerte:** Toda entidad de negocio está particionada lógicamente por `organization_id`. Las consultas filtran siempre por la organización del usuario autenticado vía JWT.
2. **Inmutabilidad y Snapshot Histórico:**
   - La tabla `Invoice` contiene campos de snapshot del receptor (`recipient_*`). Si el cliente asociado cambia de domicilio o razón social posteriormente, el comprobante fiscal permanece inalterado.
   - Todo movimiento en moneda extranjera (`USD`) guarda su tipo de cambio histórico en `exchange_rate`, asegurando que fluctuaciones cambiarias posteriores no alteren la caja histórica.
   - El snapshot del emisor (`Organization`) todavía no está: hoy la factura copia solo los datos del receptor (issue #95, pendiente).
3. **Desacoplamiento Fiscal y Comercial (Factura vs. Pago vs. Movimiento):**
   - Una `Invoice` autorizada representa un hecho fiscal y comercial, pero no mueve la caja por sí sola.
   - Cada `Payment` representa un cobro parcial o total y se vincula de forma exactamente 1:1 con un `Transaction` (`payment_id UNIQUE`).
   - El estado comercial (`PAID`, `PARTIALLY_PAID`, `PENDING`) es calculado dinámicamente (`total_amount - SUM(payments.amount)`).
4. **Baja Lógica y Trazabilidad:** Las tablas no destruyen datos históricos. Se utilizan banderas de baja lógica (`is_active` en catálogos y clientes) y marcas temporales de anulación (`voided_at` en pagos y movimientos).

---

## 2. Diagrama de Arquitectura Integral

El sistema está diseñado bajo el patrón **Monolito Modular** en el backend y una **Single Page Application (SPA)** en el frontend.

```mermaid
graph TB
    subgraph Cliente["Capa de Presentación (Frontend SPA)"]
        UI["React 19 + TypeScript + Vite"]
        Router["React Router 8 (Navegación / Rutas Protegidas)"]
        State["TanStack Query (Caché & Mutaciones HTTP)"]
        Tailwind["Tailwind CSS (UI & Responsive Design)"]
        Recharts["Recharts (Gráficos Dashboard)"]
        UI --> Router
        Router --> State
        UI --> Tailwind
        UI --> Recharts
    end

    subgraph API_GW["Capa de Red & Entrada"]
        HTTP["HTTP / JSON REST API"]
        Cors["CORS & JSON Body Parser"]
        AuthMid["Middleware de Autenticación JWT (requireAuth)"]
        ErrMid["Middleware Global de Manejo de Errores (AppError)"]
    end

    subgraph Backend["Capa de Negocio (Backend Express - Monolito Modular)"]
        ModAuth["módulo: auth (Registro, Login)"]
        ModUsers["módulo: users (Perfil, cambio de contraseña)"]
        ModOrg["módulo: organizations (Perfil Fiscal)"]
        ModCat["módulo: categories (CRUD Ingreso/Egreso)"]
        ModCli["módulo: clients (CRUD, Historial)"]
        ModTx["módulo: transactions (Movimientos Manuales, Filtros)"]
        ModInv["módulo: invoices (Borrador, Facturar)"]
        ModPay["módulo: payments (Cobranzas, Conciliación FOR UPDATE)"]
        ModDash["módulo: dashboard (Caja, Gestión, Facturado vs Cobrado)"]
        ModRate["módulo: exchange-rates (Cotización BCRA)"]
        ModArca["módulo: arca (FiscalProvider: simulado, librería facturas)"]
    end

    subgraph Datos["Capa de Persistencia"]
        Prisma["Prisma ORM 7 (Cliente Tipado & Migraciones)"]
        Postgres[(PostgreSQL 16 Engine)]
    end

    subgraph Integraciones["Servicios Externos"]
        ARCA_API["ARCA (ex AFIP) - WSAA & WSFEv1 (SOAP/HTTPS)"]
        BCRA_API["BCRA - API Estadísticas Cambiarias (REST/HTTPS)"]
    end

    %% Relaciones
    State -->|JWT Bearer + REST| HTTP
    HTTP --> Cors --> AuthMid
    AuthMid --> Backend
    Backend -.-> ErrMid

    ModAuth --> Prisma
    ModUsers --> Prisma
    ModOrg --> Prisma
    ModCat --> Prisma
    ModCli --> Prisma
    ModTx --> Prisma
    ModInv --> Prisma
    ModPay --> Prisma
    ModDash --> Prisma
    ModRate --> Prisma
    ModInv --> ModArca

    Prisma -->|Conexión TCP / Pool de Conexiones| Postgres

    ModRate -->|Fetch Cotización Oficial| BCRA_API
    ModArca -.->|Solo con ARCA_PROVIDER=sdk; todavía sin prueba real| ARCA_API
```

### Componentes de la Arquitectura
- **Frontend SPA (Vite + React 19):**
  - Renderizado completamente en cliente con TypeScript estricto.
  - El token JWT se guarda en memoria y se copia a `localStorage` para sobrevivir a una recarga. Esto lo expone a un ataque XSS; es una decisión de simplicidad para el alcance del TFI.
  - Un cliente HTTP propio (`apiFetch`) agrega el encabezado `Authorization: Bearer <token>` en cada petición.
  - Caché de datos y mutaciones con TanStack Query.
- **Backend (Node.js + Express):**
  - Separación rigurosa por módulos funcionales (`src/module/*`), cada uno compuesto por:
    - `*.schemas.ts`: Esquemas de validación de entrada con Zod.
    - `*.controller.ts`: Adaptadores HTTP que parsean parámetros y llaman al servicio.
    - `*.service.ts`: Lógica de dominio pura, reglas de negocio e interacción transaccional con Prisma.
    - `*.routes.ts`: Definición de endpoints y middlewares aplicables.
    - `*.test.ts`: Suite de pruebas unitarias y de integración del módulo con Vitest.
- **Base de Datos (PostgreSQL 16):**
  - Motor relacional que garantiza atomicidad, consistencia, aislamiento y durabilidad (ACID).
  - Bloqueo pesimista a nivel de fila (`SELECT ... FOR UPDATE`) en transacciones concurrentes de pagos y cobranzas.
  - Índices compuestos estratégicos para búsquedas por organización, fechas y clientes.
- **Integraciones Externas:**
  - **ARCA (WSAA + WSFEv1):** el sistema habla con ARCA a través de la interfaz `FiscalProvider` (`backend/src/module/arca/`). Hoy se elige por la variable `ARCA_PROVIDER`: `simulated` (cliente simulado, el que usa la demo), `sdk` (librería `facturas`, probada solo contra una simulación local y `FEDummy`) y `direct` (cliente propio, en el PR #141, sin mergear). La primera autenticación real contra homologación sigue pendiente (issue #138).
  - **BCRA:** consulta de la cotización oficial USD/ARS para sugerir el tipo de cambio de los movimientos (ver `docs/05-cotizacion.md`).

---

## 3. Diagramas de Secuencia de Flujos Críticos

### Flujo A: Facturar un borrador (con el proveedor simulado)

```mermaid
sequenceDiagram
    autonumber
    actor Usuario
    participant Frontend
    participant Backend as Backend (invoices)
    participant DB as PostgreSQL
    participant Fiscal as FiscalProvider (simulado)

    Usuario->>Frontend: Pulsa "Facturar" en un borrador y confirma
    Frontend->>Backend: POST /api/invoices/:id/authorize
    Note over Backend: Valida JWT y organización. Arma el proveedor según ARCA_PROVIDER (503 si no se puede)

    Backend->>DB: BEGIN, SELECT ... FROM invoices FOR UPDATE
    alt La factura no está en DRAFT
        Backend-->>Frontend: 409 (no se llama al proveedor)
    else Es un borrador
        Backend->>DB: UPDATE status = PENDING, COMMIT (reserva)
    end

    Backend->>DB: BEGIN (hasta 30 s), pg_advisory_xact_lock(punto de venta, tipo)
    Backend->>DB: último comprobante AUTORIZADO en la base
    Backend->>Fiscal: getLastAuthorized, número = máximo de ambos + 1
    Backend->>Fiscal: requestCae (Factura C, concepto, receptor, importes)
    alt Autorizada (con o sin observaciones)
        Fiscal-->>Backend: CAE y vencimiento
        Backend->>DB: UPDATE AUTHORIZED, voucher_number, cae, cae_expiration, authorized_at
        Backend->>DB: INSERT audit_logs (invoice.authorized), COMMIT
        Backend-->>Frontend: 200 con la factura y el resultado fiscal
        Frontend-->>Usuario: Muestra el CAE (con aviso "sin validez fiscal" si es simulado)
    else Rechazada
        Fiscal-->>Backend: Errores
        Backend->>DB: UPDATE REJECTED, arca_response, COMMIT
        Backend-->>Frontend: 200 con los motivos del rechazo
    else Sin respuesta
        Backend-->>Frontend: 202, la factura queda PENDING
    end
```

Lo que este flujo todavía **no** hace: reconciliar una factura que quedó `PENDING` (paso 3 de `docs/02-atomicidad-concurrencia.md`), reintentar una `REJECTED`, ni autenticarse con el ticket de WSAA (eso lo hace el proveedor real, aún sin probar).

---

### Flujo B: Cobro de Factura con Conciliación Atómica (Prevención de Doble Conteo)

```mermaid
sequenceDiagram
    autonumber
    actor Usuario
    participant Frontend
    participant Backend as Backend (payments)
    participant DB as PostgreSQL (Transacción ACID)

    Usuario->>Frontend: Registra cobro (opción: adoptar ingreso manual existente)
    Frontend->>Backend: POST /api/invoices/:id/payments (amount, paymentDate, currency, adoptTransactionId)
    
    Backend->>DB: BEGIN TRANSACTION
    
    Note over Backend,DB: Bloqueo pesimista de la factura
    Backend->>DB: SELECT * FROM invoices WHERE id = :id FOR UPDATE
    DB-->>Backend: Factura bloqueada

    Backend->>Backend: Valida: Estado == AUTHORIZED
    Backend->>Backend: Valida: Moneda Pago == Moneda Factura (#97)
    Backend->>Backend: Valida: Suma(pagos no anulados) + amount <= total_amount

    alt Adopta Movimiento Manual (#98)
        Note over Backend,DB: Bloqueo pesimista del movimiento
        Backend->>DB: SELECT * FROM transactions WHERE id = :adoptId FOR UPDATE
        DB-->>Backend: Movimiento bloqueado
        Backend->>Backend: Valida: payment_id IS NULL, type == INCOME, amount y currency idénticos
        Backend->>DB: INSERT INTO payments (...) RETURNING id
        Backend->>DB: UPDATE transactions SET payment_id = :paymentId, category_id = :cobroCatId WHERE id = :adoptId
    else Cobro Tradicional
        Backend->>DB: INSERT INTO payments (...) RETURNING id
        Backend->>DB: INSERT INTO transactions (type='INCOME', payment_id=:paymentId, amount, ...)
    end

    Backend->>DB: INSERT INTO audit_logs (payment.created)
    Backend->>DB: COMMIT TRANSACTION
    
    Backend-->>Frontend: 201 Created (Payment, Transaction y Saldo actualizado)
    Frontend-->>Usuario: Muestra factura como Cobrada / Cobrada Parcialmente
```

---

## 4. Conclusiones Arquitectónicas

1. **Simplicidad Operativa:** La arquitectura de monolito modular permitió a tres desarrolladores trabajar concurrentemente en módulos independientes sin incurrir en la sobrecarga operativa, de red y de despliegue de microservicios.
2. **Robustez Transaccional:** La combinación de transacciones ACID en PostgreSQL con bloqueos pesimistas (`FOR UPDATE`) cubre los cobros y la reserva del borrador al facturar. Los tests que ejercitan la concurrencia real requieren PostgreSQL y no se probaron en el entorno donde se escribió esta versión.
3. **Desacople de ARCA:** La interfaz `FiscalProvider` permite cambiar entre el simulador, la librería y el cliente propio sin tocar el resto del sistema. Eso protege a la demo de la dependencia de ARCA, aunque no reemplaza la prueba real contra homologación.
