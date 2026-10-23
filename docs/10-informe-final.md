# Informe Final del Proyecto

**Universidad Tecnológica Nacional (UTN)**  
**Carrera:** Tecnicatura Universitaria en Programación de Sistemas / TUPAD  
**Asignatura:** Trabajo Final Integrador (TFI)  
**Proyecto:** Plataforma Integral de Facturación y Gestión para Monotributistas  
**Equipo de Desarrollo:**  
- Brian Emanuel Rios
- Juan Pablo Riveros
- Nahuel Riveros  
**Fecha:** Octubre 2026  
**Estado:** Entrega Final (Versión 1.0.0)

---

## 1. Resumen Ejecutivo

El presente Trabajo Final Integrador consistió en el diseño, desarrollo, pruebas y puesta a punto de una plataforma web integral orientada a resolver las principales problemáticas administrativas, fiscales y financieras que enfrentan los trabajadores independientes y pequeños emprendedores bajo el régimen del Monotributo en Argentina.

Tradicionalmente, el monotributista gestiona su facturación en el portal web de ARCA (ex AFIP) y su economía cotidiana en planillas de cálculo dispersas o anotaciones informales. Esta desconexión genera tres problemas críticos:
1. **Falta de visibilidad sobre la caja real:** Dificultad para distinguir entre lo que se ha facturado y lo que efectivamente ha ingresado a la cuenta bancaria o caja física.
2. **Riesgo fiscal y desorden operativo:** Errores en la emisión de comprobantes y ausencia de un historial unificado por cliente y por categoría.
3. **Desfasaje en transacciones multimoneda:** Incertidumbre al percibir honorarios o registrar gastos en moneda extranjera frente a la fluctuación del tipo de cambio.

Para abordar esta necesidad, se construyó una aplicación web moderna basada en una **Single Page Application (React 18 + Vite + TypeScript)** acoplada a un **Monolito Modular de alto rendimiento (Node.js + Express + Prisma ORM + PostgreSQL 16)**, integrada directamente con los servicios de **ARCA (WSAA y WSFEv1)** y del **Banco Central de la República Argentina (BCRA)**.

---

## 2. Respuesta Explícita a las Devoluciones Docentes

A lo largo del ciclo de vida del proyecto, la cátedra proporcionó devoluciones fundamentales tras la Primera y Segunda Entrega. Cada una de ellas fue analizada en el backlog (`docs/BACKLOG.md`) y resuelta formalmente tanto en la documentación como en el código fuente:

### 2.1. Devoluciones de la Primera Entrega

| Observación Docente | Impacto en el Diseño | Resolución Técnica y Ubicación |
| :--- | :--- | :--- |
| **1. Formato y actualización de la propuesta:** La entrega inicial en PDF quedó desactualizada respecto de la evolución técnica. | La documentación viva debe acompañar al código fuente. | Se migró la propuesta completa a Markdown estructurado dentro del repositorio ([`docs/01-propuesta.md`](./01-propuesta.md)), manteniendo trazabilidad con commits y PRs. |
| **2. Ambigüedad conceptual entre Factura, Pago y Movimiento:** La cátedra señaló que facturar no equivale a cobrar y que pagos parciales podían duplicar ingresos. | Es el núcleo del dominio financiero del sistema. | Se crearon entidades separadas e independientes: `Invoice` (fiscal), `Payment` (comercial) y `Transaction` (caja). Se estableció que cada cobro genera exactamente un movimiento (`payment_id UNIQUE`), eliminando cualquier duplicación de ingresos ([`docs/04-factura-cobro-y-pagos.md`](./04-factura-cobro-y-pagos.md)). |
| **3. Modelo Relacional y Diccionario de Datos:** Exigencia de un DER formal y riguroso. | Necesidad de esquematizar restricciones, tipos de datos y unicidad. | Se estructuró el esquema Prisma multi-archivo (`backend/prisma/schema/`) y se documentó el DER en Mermaid con diccionario detallado de tablas, constraints y enums ([`docs/03-modelo-de-datos.md`](./03-modelo-de-datos.md) y [`docs/09-diagramas-y-arquitectura.md`](./09-diagramas-y-arquitectura.md)). |
| **4. Atomicidad y Concurrencia:** Riesgo de sobrepagos o inconsistencias ante cobros simultáneos. | Integridad de saldos en entornos multiusuario y peticiones paralelas. | Se implementaron transacciones Prisma `$transaction` combinadas con bloqueos pesimistas a nivel de fila (`SELECT ... FOR UPDATE`) en PostgreSQL, asegurando ACID en cobranzas concurrentes ([`docs/02-atomicidad-concurrencia.md`](./02-atomicidad-concurrencia.md)). |
| **5. Dependencia crítica de ARCA:** Riesgo de bloqueo del proyecto por demoras en homologación gubernamental. | Necesidad de desacoplamiento arquitectónico. | Se diseñó un `ArcaClient` con patrón Adapter y plan de contingencia ([`docs/06-plan-b-arca.md`](./06-plan-b-arca.md)), permitiendo alternar entre homologación real y simulación determinista para testing automatizado. |
| **6. Cotización y Multimoneda:** Claridad sobre la cotización utilizada para gestión económica. | Separación entre cotización fiscal y cotización de caja. | Se integró la API oficial de Estadísticas Cambiarias del BCRA y se definió el almacenamiento inmutable del tipo de cambio histórico en cada movimiento en moneda extranjera ([`docs/05-cotizacion.md`](./05-cotizacion.md)). |

### 2.2. Devoluciones de la Segunda Entrega

| Observación Docente | Issue / Tarea | Resolución Implementada |
| :--- | :--- | :--- |
| **1. Moneda heterogénea en pagos:** El control de saldos no puede sumar pagos en USD sobre facturas en ARS directamente. | **Issue #97** (`feat(payments)`) | Se fijó la regla de negocio estricta `Payment.currency == Invoice.currency`. En el P0, si un pago difiere de la moneda del comprobante, el backend lo rechaza inmediatamente con error HTTP `422 Unprocessable Entity`. Cuenta con test de integración automatizado en `payments.test.ts`. |
| **2. Doble conteo entre ingresos manuales y facturas:** Si el monotributista anota un ingreso manual hoy y factura dentro de 5 días, el resultado de gestión sumaba dos veces la venta. | **Issue #98** (`feat(dashboard)`) | Se implementó el **patrón de adopción** (`adoptTransactionId`) en `registerPayment`: el pago bloquea y asocia el movimiento manual preexistente en lugar de crear uno nuevo. En el Dashboard se desagregó la fórmula: $\text{Gestión} = \text{invoiced} + \text{manualIncome} - \text{expense}$, garantizando unicidad económica. |
| **3. Snapshot histórico del emisor en la factura:** Si la organización cambia de domicilio comercial o razón social, las facturas emitidas en el pasado no deben mutar. | **Issue #95** (`feat(invoices)`) | El comprobante autorizado persiste de forma inmutable los datos fiscales del emisor y receptor vigentes al momento de la autorización ARCA. |
| **4. Simplificación de la moneda base en P0:** Complejidad innecesaria si la organización opera en base USD sin ser exportadora pura. | **Issue #96** (`feat(organizations)`) | Se estableció `baseCurrency = 'ARS'` para la organización en el P0. Los movimientos en USD se admiten plenamente convirtiéndose a ARS mediante el tipo de cambio histórico registrado. |
| **5. Unicidad de Actividad Primaria:** Regla para evitar organizaciones con múltiples actividades principales. | **Issue #99** (`feat(activities)`) | Validación y transacción que garantiza que al marcar una actividad como primaria se desmarquen automáticamente las restantes de la misma organización. |

---

## 3. Alcance Final del Sistema: P0 vs. P1 / P2

Para cumplir rigurosamente con los plazos de entrega sin comprometer la solidez de la arquitectura, se aplicó una priorización estricta basada en el valor para el usuario y la integridad transaccional:

### 3.1. Funcionalidades Incluidas en el P0 (Core MVP - 100% Operativo)

1. **Autenticación y Seguridad:**
   - Registro de usuarios con contraseñas cifradas mediante Argon2id.
   - Inicio de sesión con emisión de tokens JWT firmados (expiración de 8 horas).
   - Flujo de recuperación de contraseña con token criptográfico de un solo uso.
   - Aislamiento multi-tenant por `organization_id` verificado en cada consulta a la base de datos.
2. **Onboarding y Perfil Fiscal:**
   - Alta asistida de la Organización tras el primer login (CUIT, razón social, condición fiscal, domicilio).
   - Generación automática de categorías iniciales del negocio y del Punto de Venta N° 1 habilitado ante ARCA.
3. **Catálogos Comerciales:**
   - CRUD completo de Clientes con documento (CUIT/DNI), datos de contacto, condición fiscal y baja lógica (`is_active`).
   - CRUD de Categorías de ingresos y egresos con validación de unicidad por nombre y organización.
4. **Gestión Financiera de Caja (Movimientos):**
   - Registro manual de ingresos y egresos en pesos (ARS) y dólares (USD).
   - Consulta y captura de tipo de cambio oficial en tiempo real vía BCRA o ingreso manual asistido.
   - Listado paginado con filtros combinados por rango de fechas, categoría, tipo de movimiento y moneda.
   - Historial cronológico de movimientos asociados por cliente.
5. **Facturación Electrónica (ARCA):**
   - Gestión de comprobantes en borrador (`DRAFT`) con cálculo dinámico de subtotales, totales y fechas de servicio.
   - Autorización fiscal electrónica contra ARCA (WSFEv1 Factura C) con asignación de CAE y fecha de vencimiento.
   - Almacenamiento de observaciones y códigos de error oficiales devueltos por el Web Service fiscal.
6. **Cobranzas y Conciliación Atómica:**
   - Registro de pagos parciales y totales sobre facturas autorizadas.
   - Cálculo en tiempo real del saldo pendiente y estado comercial (`PENDING`, `PARTIALLY_PAID`, `PAID`).
   - Prevención de sobrepagos mediante transacciones concurrentes seguras (`SELECT ... FOR UPDATE`).
   - Conciliación de cobros mediante adopción de movimientos manuales preexistentes (`adoptTransactionId`).
7. **Dashboard y Métricas de Gestión:**
   - Visualización clara y diferenciada del **Resultado de Caja** (dinero real) y **Resultado de Gestión** (económico devengado).
   - Panel de control comparativo de **Facturado vs. Cobrado en el período**.
   - Gráficos interactivos de distribución de gastos e ingresos por categoría (Recharts).
8. **Auditoría del Sistema:**
   - Registro automático e inmutable de eventos críticos (`auth.login`, `invoice.authorized`, `payment.created`) en la tabla `audit_logs`.

### 3.2. Funcionalidades Postergadas a P1 / P2 (Justificación Técnica)

| Tarea Postergada | Prioridad | Justificación de la Postergación |
| :--- | :---: | :--- |
| **[P1-1] Central de Deudores del BCRA** | P1 | Servicio accesorio informativo. No afecta la integridad del circuito central de ventas y cobros del monotributista. |
| **[P1-2] Notificaciones WhatsApp (Kapso)** | P1 | Canal de mensajería externo. Se priorizó garantizar que la factura esté autorizada con CAE y cobrada antes de agregar canales de distribución externa. |
| **[P1-3] Facturas A y B** | P2 | El Monotributo emite Factura C en más del 98% de los casos. Facturas A y B requieren cálculo y discriminación de alícuotas de IVA (21%, 10.5%, etc.) que no aplican a la operatoria estándar del monotributista. |
| **[P1-4] Exportación de Reportes a PDF/Excel** | P2 | La interfaz del Dashboard y las tablas con filtros avanzados ya permiten la consulta y conciliación completa en pantalla. La exportación binaria agrega costo de dependencias sin aportar nuevas reglas de negocio. |

---

## 4. Arquitectura y Metodología de Desarrollo

### 4.1. El Monolito Modular
Se optó deliberadamente por un **Monolito Modular** en Node.js + Express en lugar de una arquitectura de microservicios:
- **Separación de Responsabilidades:** Cada módulo (`auth`, `organizations`, `clients`, `categories`, `invoices`, `payments`, `transactions`, `dashboard`, `arca`, `exchange-rates`) encapsula sus propios esquemas Zod, controladores, servicios y tests.
- **Transaccionalidad Directa:** Permite ejecutar operaciones complejas (como registrar un pago, actualizar el estado comercial, asociar el movimiento y generar el log de auditoría) dentro de una única transacción atómica de base de datos (`prisma.$transaction`), algo que en microservicios exigiría patrones distribuidos de alta complejidad (Saga/2PC).
- **Mantenibilidad y Simplicidad:** Despliegue en un único contenedor o proceso, facilitando el trabajo colaborativo sin latencia de red entre servicios.

### 4.2. Base de Datos y Estrategia Multi-Tenant
- PostgreSQL 16 alojado en contenedor Docker dedicado.
- Multi-tenancy lógico mediante clave foránea obligatoria `organization_id` en todas las tablas del negocio.
- Uso de tipos de datos de alta precisión: `Decimal(18, 2)` para montos monetarios y `Decimal(18, 6)` para cotizaciones, evitando los errores de redondeo de punto flotante binario (`IEEE 754`).

---

## 5. Aseguramiento de la Calidad (QA y Testing)

El proyecto cuenta con una cobertura integral de pruebas automatizadas y manuales:

### 5.1. Métricas de la Suite Automatizada
- **Backend (Vitest + Supertest):** **86 tests pasando al 100%**.
  - Pruebas unitarias de esquemas de validación Zod (rechazo de fechas inválidas, montos desmedidos, payloads truncados).
  - Pruebas de integración sobre base de datos PostgreSQL real (aislamiento de transacciones, concurrencia de pagos `FOR UPDATE`, adopción de movimientos).
  - Tests de servicios de organizaciones (7 tests) y categorías (9 tests).
- **Frontend (Vitest + React Testing Library):** **31 tests pasando al 100%**.
  - Validación de renderizado de componentes, navegación, formateo de importes y visualización de errores de red.

### 5.2. Ronda de QA General (F9-6 y F9-7)
Previo a la entrega final se ejecutó una exhaustiva ronda de QA manual y funcional cruzada de punta a punta (documentada en el Issue #74):
- Se relevaron y corrigieron los bugs bloqueantes P0 (persistencia de organizaciones y módulo de categorías en el backend, cerrados en el Issue #75 con PR #142).
- Se corrigió la codificación de caracteres acentuados (UTF-8) en la base de datos PostgreSQL.
- Se comprobó el flujo completo: Registro $\rightarrow$ Onboarding $\rightarrow$ Creación de Cliente $\rightarrow$ Alta de Categoría $\rightarrow$ Emisión y Autorización de Factura C $\rightarrow$ Cobranza Parcial y Total $\rightarrow$ Verificación en Dashboard y Caja.

---

## 6. Conclusiones y Lecciones Aprendidas

1. **El valor del rigor conceptual temprano:** El tiempo invertido en clarificar las fronteras entre Factura, Pago y Movimiento evitó reescrituras estructurales mayores en etapas avanzadas del proyecto.
2. **Concurrencia real:** La implementación de bloqueos a nivel de fila (`FOR UPDATE`) en PostgreSQL demostró que la integridad financiera debe asegurarse a nivel de base de datos y no depender exclusivamente de la memoria de la aplicación.
3. **Resiliencia ante APIs externas:** Trabajar contra servicios estatales (ARCA y BCRA) exige diseñar con fallos en mente: mecanismos de reintento, caché de tickets de acceso y contratos desacoplados son indispensables para mantener la alta disponibilidad de la aplicación.

El sistema resultante es una solución robusta, intuitiva y profesional, lista para acompañar al monotributista en su crecimiento cotidiano con total tranquilidad fiscal y financiera.
