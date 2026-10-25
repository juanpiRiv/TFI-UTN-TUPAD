# Informe Final del Proyecto

**Universidad Tecnológica Nacional (UTN)**
**Carrera:** Tecnicatura Universitaria en Programación
**Asignatura:** Trabajo Final Integrador (TFI)
**Proyecto:** Sistema web de gestión financiera y facturación electrónica para monotributistas
**Equipo:**
- Rivero Albornoz, Juan Pablo
- Rios, Brian Emanuel
- Riveros Valgañón, Nahuel Nicolás

**Fecha:** Octubre 2026
**Estado:** tercera entrega. Describe el release que se publica en `main`. Los datos son del 24/10/2026 y salen del código y de los issues y PRs del repositorio.

> Este informe describe lo que está integrado en el release de `main`. Lo pendiente está en la sección 3.2. La integración real con ARCA todavía no se probó contra homologación: lo que se ve funcionando usa el proveedor simulado.

---

## 1. Resumen

El proyecto es una aplicación web para monotributistas que unifica dos cosas que hoy viven separadas: la facturación en el portal de ARCA y el control de ingresos y egresos en planillas. La idea central es que **facturar, cobrar y mover plata son tres conceptos distintos**: una factura no mueve la caja; la mueve cada cobro.

Stack, según los `package.json` y el esquema del repositorio:
- **Frontend:** React 19, TypeScript 6, Vite 8, Tailwind CSS 4, React Router 8, TanStack Query 5, Recharts 3.
- **Backend:** Node.js, Express 5, TypeScript, Zod 4, un módulo por carpeta en `backend/src/module/`.
- **Datos:** PostgreSQL 16 y Prisma 7.
- **Seguridad:** contraseñas con Argon2id y sesión con JWT de 1 día.
- **Integraciones:** BCRA (cotización USD/ARS) y ARCA (WSAA y WSFEv1) a través de la interfaz `FiscalProvider`. Con el proveedor simulado el recorrido funciona de punta a punta; contra ARCA de verdad todavía no.

---

## 2. Respuesta a las devoluciones docentes

### 2.1. Primera entrega

| Observación | Resolución | Estado |
| :--- | :--- | :--- |
| Formato y actualización de la propuesta | Se migró a Markdown: [`docs/01-propuesta.md`](./01-propuesta.md). | Hecho |
| Factura, pago y movimiento no son lo mismo; los pagos parciales no deben duplicar ingresos | `Invoice`, `Payment` y `Transaction` son tablas separadas. Cada pago genera como máximo un movimiento (`payment_id` único). Reglas en [`docs/04-factura-cobro-y-pagos.md`](./04-factura-cobro-y-pagos.md). | Hecho |
| DER y diccionario de datos | DER corregido y diccionario en [`docs/03-modelo-de-datos.md`](./03-modelo-de-datos.md). Esquema de Prisma en `backend/prisma/schema/` y diagramas en [`docs/10-diagramas-y-arquitectura.md`](./10-diagramas-y-arquitectura.md). | Hecho |
| Atomicidad y concurrencia | Los cobros corren en una transacción con `SELECT ... FOR UPDATE` sobre la factura, y al facturar la numeración se toma con un bloqueo consultivo por punto de venta. Diseño en [`docs/02-atomicidad-concurrencia.md`](./02-atomicidad-concurrencia.md). | Hecho |
| Dependencia de ARCA | Interfaz `FiscalProvider` con un cliente simulado y uno sobre la librería `facturas`, y el plan B de [`docs/06-plan-b-arca.md`](./06-plan-b-arca.md). El cliente propio está en el PR #141 (borrador). Evaluación en [`docs/arca/evaluacion-tecnica.md`](./arca/evaluacion-tecnica.md). | Parcial: falta la prueba real (ver 2.3) |
| Cotización y multimoneda | Definición en [`docs/05-cotizacion.md`](./05-cotizacion.md). El backend consulta al BCRA y cada movimiento en dólares guarda su tipo de cambio. | Hecho |

### 2.2. Segunda entrega

| Observación | Issue | Estado |
| :--- | :--- | :--- |
| Moneda del pago igual a la de la factura | [#97](https://github.com/juanpiRiv/TFI-UTN-TUPAD/issues/97) | Hecho: el backend rechaza con 422 y hay test. El issue sigue abierto para revisar su cierre. |
| Doble conteo entre ingresos manuales y facturas | [#98](https://github.com/juanpiRiv/TFI-UTN-TUPAD/issues/98) | Hecho en el código: un cobro puede adoptar un movimiento manual (`adoptTransactionId`) y el resultado de gestión se calcula como facturado + ingresos manuales − egresos. El issue sigue abierto. |
| Snapshot del emisor en la factura | [#95](https://github.com/juanpiRiv/TFI-UTN-TUPAD/issues/95) | **Pendiente.** Hoy se copian los datos del receptor, no los del emisor. |
| Moneda base fija en ARS para el P0 | [#96](https://github.com/juanpiRiv/TFI-UTN-TUPAD/issues/96) | **Pendiente.** El modelo todavía admite otra moneda base. |
| Una sola actividad primaria por organización | [#99](https://github.com/juanpiRiv/TFI-UTN-TUPAD/issues/99) | **Pendiente.** Todavía no hay endpoints de actividades. |

### 2.3. Tercera entrega

| Pedido | Estado |
| :--- | :--- |
| Evaluación técnica de dos alternativas para ARCA, con decisión justificada | Hecho: se eligió la librería `facturas` como camino principal, el cliente propio como respaldo y un simulador para la demo ([evaluación](./arca/evaluacion-tecnica.md)). |
| Interfaz propia para la facturación (`FiscalProvider`) | Hecho, con tests de contrato. El proveedor se elige con `ARCA_PROVIDER`. |
| Pruebas contra homologación | **Parcial.** Se probó `FEDummy`, el rechazo del WSAA a un certificado de prueba y un error 600 de WSFEv1. Hay un certificado de homologación emitido el 22/10, pero todavía no hubo una autenticación exitosa ni una emisión real (issue #138). |
| Perfil de usuario y perfil fiscal de la organización | Hecho. |
| Relevamiento con usuarios reales | Hecho con 3 respuestas; las conclusiones aclaran qué está confirmado y qué es débil ([relevamiento](./07-relevamiento.md)). |

---

## 3. Alcance

### 3.1. Funcionando en el release

1. **Autenticación:** registro e inicio de sesión (Argon2id y JWT de 1 día), cambio de contraseña y perfil de usuario. El aislamiento por organización se aplica en las consultas del backend.
2. **Organización:** alta y edición del perfil fiscal (CUIT, razón social, condición frente al IVA). Al crearla se generan las categorías por defecto.
3. **Clientes:** alta, edición, baja lógica, búsqueda e historial de operaciones.
4. **Categorías:** listar, crear y editar.
5. **Movimientos:** ingresos y egresos en ARS y USD, con filtros por fecha, tipo y categoría y sugerencia de cotización del BCRA.
6. **Cobros:** pagos parciales o totales sobre facturas autorizadas, con control de saldo y de moneda, y adopción de un ingreso manual existente.
7. **Dashboard:** resultado de caja, resultado de gestión y facturado contra cobrado, con gráficos de Recharts.
8. **Facturas en borrador:** crear una factura con uno o más ítems, con subtotales y total calculados por el backend y los datos del receptor copiados; pantalla de alta y listado Todavía no se pueden editar.
9. **Facturar:** el botón **Facturar** de un borrador pide el CAE al proveedor fiscal elegido con `ARCA_PROVIDER` y deja la factura autorizada, rechazada o pendiente. Hoy funciona con el **proveedor simulado**: el CAE no tiene validez fiscal y la pantalla lo avisa.
10. **Auditoría:** hay una tabla `audit_logs` y se registran altas de organización, movimientos, pagos, facturas creadas y facturas autorizadas o rechazadas. El login todavía no se audita.
11. **Despliegue:** el backend está en línea en Render (`https://tfi-utn-tupad.onrender.com`, con su base PostgreSQL y el proveedor de ARCA simulado) y el frontend se publica en Cloudflare Pages con un workflow de GitHub Actions. Guía y estado verificado en [`docs/09-deploy.md`](./09-deploy.md).

### 3.2. Pendiente

- Emisión real contra ARCA (la primera prueba contra homologación, issue #138) y los códigos de condición IVA del receptor, que no están verificados contra el catálogo oficial.
- Reconciliación de facturas que quedan pendientes y reenvío de las rechazadas.
- PDF del comprobante (#55).
- Recuperación de contraseña: existe la tabla, pero no el flujo.
- Actividades y puntos de venta con pantalla propia (#26, #27).
- Retirar los mocks de MSW (PR #144, hay que rehacerlo contra `main`).
- Pruebas E2E y de integración (#61 a #66) y revisión de seguridad (#66).
- Probar el sistema desplegado de punta a punta (#73): el backend responde en Render y el frontend está publicado en Cloudflare Pages; falta recorrer el flujo completo desde el navegador y cargar los datos de prueba en la base.

### 3.3. Postergado a P1 / P2

| Funcionalidad | Issue | Por qué se posterga |
| :--- | :--- | :--- |
| Central de Deudores del BCRA | #84 | Es informativa; no afecta el circuito de ventas y cobros. |
| Notificaciones por WhatsApp (Kapso) | #85 | Primero tiene que haber facturas autorizadas y cobros. |
| Otros comprobantes además de Factura C | #86 | Requieren discriminar IVA, que no aplica al monotributo. |
| Reportes de gestión exportables | #87 | El dashboard ya permite consultar y conciliar en pantalla. |

---

## 4. Arquitectura

Es un **monolito modular**: un solo proceso de Express con un módulo por carpeta (`auth`, `users`, `organizations`, `categories`, `clients`, `transactions`, `invoices`, `payments`, `dashboard`, `exchange-rates` y `arca`). Cada uno tiene sus esquemas de Zod, controlador, servicio y tests. Se eligió porque permite ejecutar operaciones como un cobro (pago, movimiento y auditoría) dentro de una sola transacción de base de datos, sin coordinar servicios distintos.

El aislamiento entre organizaciones se resuelve en cada servicio, filtrando por `organization_id`. Montos con `Decimal(18, 2)` y cotizaciones con `Decimal(18, 6)`. Detalle en [`docs/10-diagramas-y-arquitectura.md`](./10-diagramas-y-arquitectura.md).

---

## 5. Pruebas

En el release, al 24/10/2026:
- **Backend (Vitest y Supertest):** 233 tests pasan y 17 de integración se saltan cuando no hay PostgreSQL. Tres suites (`invoices`, `payments` y la de RN-06) necesitan `DATABASE_URL` y `JWT_SECRET` y fallan si faltan esas variables.
- **Frontend (Vitest y Testing Library):** 55 tests pasan.
- Los tests que prueban concurrencia real (`FOR UPDATE`) requieren PostgreSQL local (`docker compose up -d`) y no se ejecutaron en el entorno donde se actualizó este informe.

La ronda de QA general quedó registrada en el issue #74 y sus correcciones en #75.

---

## 6. Conclusiones

1. **El rigor conceptual temprano ahorró retrabajo.** Definir desde el principio las diferencias entre factura, pago y movimiento evitó cambios estructurales en el modelo.
2. **La integridad financiera se asegura en la base.** Los bloqueos de fila en PostgreSQL protegen los cobros aunque haya pedidos simultáneos; no se dejó solo en la memoria de la aplicación.
3. **Depender de un servicio estatal exige un plan de contingencia.** La demora para conseguir el certificado de homologación mostró el riesgo: por eso la interfaz `FiscalProvider` y el simulador permitieron seguir avanzando, y por eso la integración real se declara como pendiente y no como terminada.
4. **Lo que sigue.** Para cerrar el proyecto falta la prueba real contra homologación, la reconciliación de facturas pendientes, el PDF, las pruebas de punta a punta y el despliegue público.
