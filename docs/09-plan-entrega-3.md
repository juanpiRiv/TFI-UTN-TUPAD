# Plan hacia la tercera entrega

Qué corregir de la devolución de Oscar y qué construir para la próxima entrega. Oscar pidió que el código demuestre el modelo, así que este plan prioriza backend real sobre documentación. Solo se escribe documentación cuando una decisión de código lo requiere.

> **A confirmar:** la fecha exacta de la tercera entrega. Este plan asume el fin de la fase 7 del [roadmap](./01-propuesta.md#17-roadmap-del-proyecto) (25/10). Si la fecha cambia, se corre la tabla de semanas.

## Qué pidió Oscar

1. Ajustes de modelo antes de dar por cerrado el diseño: snapshot del emisor, moneda base ARS, moneda del pago igual a la de la factura, doble conteo en el dashboard e `isPrimary` protegido.
2. Cerrar el relevamiento con entrevistas reales y conclusiones.
3. Si el certificado de ARCA está bloqueado, documentar el bloqueo. Cuando se pueda, el orden es WSAA → ticket de acceso → primera llamada válida a WSFEv1.
4. Lo más importante: el recorrido vertical real, sin mocks. Backend en este orden: **Organization → Client → Category → Transaction → Dashboard**, y después **Invoice → Payment → Transaction**.

## Estado de partida (11/10)

| Área | Hoy |
| --- | --- |
| Backend | Solo `auth` y el esquema Prisma. `feature/organizations` tiene organización, auditoría y aislamiento por organización, sin PR |
| Frontend | Pantallas completas, pero todo salvo auth corre con mocks de MSW |
| `develop` | No existe en el remoto. Hay que recrearla (ver [guía del equipo](./10-guia-del-equipo.md#recrear-develop)) |
| ARCA | Sin certificado de homologación. Hoy vence el primer control del [plan B](./06-plan-b-arca.md) |
| Relevamiento | Guion y encuesta listos, resultados vacíos |

## Bloques de trabajo

### A. Ajustes de modelo (corrección de Oscar)

Son cambios chicos en el esquema Prisma, una migración y la actualización de los `.md` que ya existen. Se hacen primero porque el resto del código se apoya en el modelo.

| Issue | Qué se hace | Responsable |
| --- | --- | --- |
| #96 | `Organization.baseCurrency` fijo en ARS para el P0. Se siguen aceptando movimientos en USD con su cotización histórica | Juanpi |
| #99 | Una sola actividad primaria por organización, con índice único parcial y validación en el servicio | Nahuel |
| #95 | Snapshot del emisor en `Invoice` (CUIT, razón social, domicilio, condición fiscal, IIBB, inicio de actividades) | Nahuel |
| #97 | La moneda de un `Payment` es la de su `Invoice`: se valida en el servicio y se quita el `exchangeRate` propio del pago | Brian |
| #98 | Definir "ingreso manual" y evitar el doble conteo con las facturas (ver abajo) | Brian |

**Decisión pendiente del #98.** Un ingreso manual de una venta que después se factura se contaría dos veces. La propuesta para discutir entre los tres es que un `Transaction` manual de ingreso puede vincularse opcionalmente a una factura. En ese caso el dashboard cuenta la factura y descarta ese movimiento en el resultado de gestión. Hay que decidirlo antes de programar el dashboard.

Al terminar el bloque se actualizan [03-modelo-de-datos.md](./03-modelo-de-datos.md), [04-factura-cobro-y-pagos.md](./04-factura-cobro-y-pagos.md), [05-cotizacion.md](./05-cotizacion.md) y [`database/schema.sql`](../database/schema.sql), que se regenera desde las migraciones.

### B. Recorrido vertical real (lo más importante)

Cada módulo sigue la estructura de `backend/src/module/auth/` (`routes`, `controller`, `service`, `schemas`). Los endpoints son los del [contrato de la API](./08-contrato-api.md). Al terminar cada uno, el frontend deja de usar el mock de ese módulo.

| Orden | Módulo | Issues | Responsable | Depende de |
| --- | --- | --- | --- | --- |
| 1 | Organization (+ actividades y puntos de venta) | #25, #26, #27 | Juanpi y Nahuel | `feature/organizations` y bloque A |
| 2 | Client | #28, #29 | Brian | 1 |
| 2 | Category | #30 | Nahuel | 1 |
| 3 | Transaction | #31, #32 | Brian | 2 |
| 4 | Dashboard | #33 | Brian | 3 y decisión del #98 |
| 5 | Seeds de datos de prueba | #21 | Brian | 1 al 4 |

Cierre del bloque: `VITE_USE_MOCKS=false` y el flujo registro → organización → cliente → movimiento → dashboard funciona contra PostgreSQL. Se actualizan las capturas del [README del frontend](../frontend/README.md#capturas) y la tabla de la segunda entrega del README.

### C. Invoice → Payment → Transaction

Es donde se prueba en código la separación entre factura, pago y movimiento. Va después del bloque B.

| Orden | Qué | Issues | Responsable |
| --- | --- | --- | --- |
| 1 | CRUD de facturas con ítems, estados y Factura C, sin ARCA | #45, #46, #48, #50 | Nahuel |
| 2 | Pago que genera un `Transaction`, con tope por saldo y bloqueo de la factura (ver [atomicidad](./02-atomicidad-concurrencia.md)) | #51 | Brian |
| 3 | Pantalla de pagos y dashboard de facturado contra cobrado | #52, #53 | Brian |
| 4 | Campos de CAE y PDF del comprobante | #54, #55 | Nahuel |

Los tests de concurrencia del pago (dos pagos simultáneos que juntos superan el total) son parte del criterio de cierre del #51.

### D. ARCA (corre en paralelo, lo lleva Juanpi)

| Orden | Qué | Issue |
| --- | --- | --- |
| 1 | Conseguir el certificado de homologación. Si está bloqueado por algo externo, documentarlo en [06-plan-b-arca.md](./06-plan-b-arca.md) con fecha y motivo | #40 |
| 2 | WSAA: pedir el ticket de acceso | #41 |
| 3 | Primera llamada válida a WSFEv1 (`FEDummy` y `FECompUltimoAutorizado`) | #43 |
| 4 | Renovación automática del ticket | #42 |

Hoy es 11/10 y el primer control del plan B es el 12/10, así que si el certificado no está, se activa el escalón 1 y se deja constancia en el `.md`. El resto de ARCA (#56 al #60) queda detrás de `ArcaClient` con la implementación simulada, como define el plan B.

### E. Relevamiento (lo lleva Nahuel)

#8 y #9. Mínimo 3 respuestas, 5 si se puede, con al menos un caso de cada variante (productos, servicios, ambos). Se completa la tabla de [07-relevamiento.md](./07-relevamiento.md) y se escriben las conclusiones.

### F. Orden del repositorio

- Recrear `develop` y abrir el PR de `feature/organizations`.
- Cerrar #100 y revisar qué issues del frontend (#28 al #33) tienen la parte de UI hecha, y anotarlo en cada uno.
- Actualizar el README: la entrega 2 recibió la corrección y el estado del backend cambió.
- Cada PR de release `develop → main` usa `Closes #n` para que se cierren los issues.

## Calendario propuesto

| Semana | Foco | Entregable verificable |
| --- | --- | --- |
| 11/10 al 14/10 | `develop`, bloque A, Organization real, control de ARCA del 12/10 | Migración de ajustes en `develop` y organización contra PostgreSQL |
| 15/10 al 19/10 | Client, Category, Transaction. Entrevistas del relevamiento. WSAA | Clientes y movimientos reales. 3 entrevistas cargadas |
| 20/10 al 25/10 | Dashboard, Invoice y Payment. Primera llamada a WSFEv1. QA del recorrido | Recorrido vertical sin mocks, pago parcial en código, release a `main` |

Regla de entrega: lo que no está pusheado y mergeado a `main` antes de la fecha no cuenta, porque Oscar toma la fecha de los commits. El release `develop → main` se abre 2 días antes.

## Riesgos

| Riesgo | Qué hacemos |
| --- | --- |
| El certificado de ARCA no llega | Se documenta el bloqueo y se sigue con `ArcaClient` simulado. No frena a nadie |
| Dependencias entre módulos frenan a alguien | Cada uno arranca contra el contrato de la API y los mocks hasta que el módulo anterior esté mergeado |
| Conflictos en `schema.prisma` entre ramas | Los cambios de modelo del bloque A entran primero. Después, cada migración nueva se rebasa o se mergea desde `develop` antes del PR |
| Seguir invirtiendo en docs y mocks | Ningún `.md` nuevo salvo que una decisión de código lo pida |

## Definition of Done de la entrega 3

- [ ] Ajustes de modelo de Oscar aplicados: esquema, migración, `schema.sql` y docs al día.
- [ ] Flujo usuario → organización → cliente → movimiento → dashboard sin mocks, sobre PostgreSQL.
- [ ] Pago parcial funcionando en código, con Payment y Transaction en la misma transacción de base de datos.
- [ ] Relevamiento con al menos 3 respuestas y conclusiones.
- [ ] ARCA: evidencia del spike (ticket WSAA y primera llamada a WSFEv1) o bloqueo documentado.
- [ ] Todo en `main`, con README y capturas actualizados.
