# Plan hacia la tercera entrega

Qué corregir de la devolución de Oscar y qué construir para la próxima entrega. Oscar pidió que el código demuestre el modelo, así que este plan prioriza backend real sobre documentación. Solo se escribe documentación cuando una decisión de código lo requiere.

> **A confirmar con Oscar:** la fecha exacta de la tercera entrega. Este plan asume el fin de la fase 7 del [roadmap](./01-propuesta.md#17-roadmap-del-proyecto) (domingo 25/10). Como solo cuenta lo que está mergeado antes de la fecha, el cierre efectivo es el **viernes 23/10** y el fin de semana queda solo como margen. Si la fecha real cambia, se corre la tabla del plan día por día.

## Qué pidió Oscar

1. Ajustes de modelo antes de dar por cerrado el diseño: snapshot del emisor, moneda base ARS, moneda del pago igual a la de la factura, doble conteo en el dashboard e `isPrimary` protegido.
2. Cerrar el relevamiento con entrevistas reales y conclusiones.
3. Si el certificado de ARCA está bloqueado, documentar el bloqueo. Cuando se pueda, el orden es WSAA → ticket de acceso → primera llamada válida a WSFEv1.
4. Lo más importante: el recorrido vertical real, sin mocks. Backend en este orden: **Organization → Client → Category → Transaction → Dashboard**, y después **Invoice → Payment → Transaction**.

## Estado de partida (11/10)

| Área | Hoy |
| --- | --- |
| Backend | Solo `auth` y el esquema Prisma. `feature/organizations` tiene organización, auditoría y aislamiento por organización, sin PR, y con defectos que hay que corregir antes de repartir módulos (ver bloque B) |
| Frontend | Pantallas completas, pero todo salvo auth corre con mocks de MSW |
| `develop` | No existe en el remoto. Ver la decisión pendiente del modelo de ramas en el bloque F |
| ARCA | Sin certificado de homologación. El primer control del [plan B](./06-plan-b-arca.md) vence el 12/10 |
| Relevamiento | Guion y encuesta listos, resultados vacíos |

## Bloques de trabajo

### A. Ajustes de modelo (corrección de Oscar)

Son cambios chicos en el esquema Prisma y en los `.md` que ya existen. Se hacen primero porque el resto del código se apoya en el modelo.

**Una sola migración, un solo autor.** Las migraciones son la única carpeta lineal que no se puede mergear en paralelo, así que los cinco ajustes entran en una rama única de ajustes de modelo con **una migración y un autor**. Se propone a Nahuel, que ya tiene #95, #96 y #99. Brian y Juanpi aportan el SQL o el esquema por comentario o push a esa rama. Los enums se cierran ahí también. La rama se mergea el primer día posible y, después, cualquier migración nueva se avisa al equipo y la crea el autor único.

| Issue | Qué se hace | Responsable |
| --- | --- | --- |
| #96 | `Organization.baseCurrency` fijo en ARS para el P0: `CHECK (base_currency = 'ARS')` y la API no acepta otra moneda base. Se siguen aceptando movimientos en USD con su cotización copiada. Se marca como resuelta la pregunta abierta de [08-contrato-api.md](./08-contrato-api.md) sobre limitar la moneda base y se corrigen las líneas del contrato que hablan de `baseCurrency` y de "distinta de la moneda base" | Nahuel |
| #99 | Una sola actividad primaria por organización. El índice único parcial se declara en `schema.prisma` con el preview `partialIndexes` (no solo en SQL, por un bug abierto de Prisma que genera `DROP INDEX` en cada `migrate dev`). El servicio cambia la primaria en dos sentencias dentro de una transacción (primero desmarca, después marca) y traduce `P2002` a 409 | Nahuel |
| #95 | Snapshot del emisor en `Invoice` con columnas `issuer_*` (CUIT, razón social, domicilio, condición fiscal, IIBB, inicio de actividades), por simetría con las columnas `recipient_*`. Se copia en la transición DRAFT → PENDING y no al crear, porque un borrador puede vivir días. Un `CHECK` exige el snapshot completo desde PENDING. El domicilio del emisor sale de `pointOfSale.address` y, si falta, de `commercialAddress`: sin confirmar | Nahuel |
| #97 | La moneda de un `Payment` es la de su `Invoice`. Se agrega una FK compuesta `(invoice_id, currency)` hacia `invoices(id, currency)` con `@@unique([id, currency])` y `onUpdate: Restrict`. Se quita el `exchangeRate` del pago y también el CHECK `payments_exchange_rate_required`. El servicio copia la moneda de la factura bloqueada al `Payment` y al `Transaction` e ignora la del body. Sin verificar: si `payment.create` con relación compuesta compila con `connect` | Brian |
| #98 | Definir "ingreso manual" y evitar el doble conteo con las facturas (ver abajo) | Brian |

**Decisión pendiente del #98.** Un ingreso manual de una venta que después se factura se contaría dos veces en el resultado de gestión. Opciones:

- Vincular un `Transaction` manual a una factura, y que el dashboard cuente la factura y descarte el movimiento (propuesta original de este plan). Evita el doble conteo, pero la factura queda "Pendiente" aunque ya esté cobrada y hay dos fuentes de verdad sobre lo cobrado.
- **Recomendada por la investigación: adoptar el movimiento como cobro.** `registerPayment` recibe un `adoptTransactionId` opcional. Dentro de la transacción con la factura bloqueada se valida organización, tipo INCOME, `payment_id` nulo, movimiento no anulado, misma moneda e importe, se crea el `Payment` y se asigna su `payment_id` al movimiento. No agrega columnas, la factura queda "Cobrada" y caja y gestión coinciden. Límites: un movimiento cubre un solo pago, y mientras el usuario no concilie el doble conteo existe, por lo que hace falta un aviso de "ingresos manuales sin factura".
- Un flag manual en el movimiento.

Estado: **Decisión pendiente**, a confirmar entre los tres y con Oscar antes de cerrar la migración (13/10). Como `adoptTransactionId` no toca el esquema, la migración del bloque A no cambia con esta decisión. El detalle de las reglas de resultado está en [04-factura-cobro-y-pagos.md](./04-factura-cobro-y-pagos.md).

Al terminar el bloque se actualizan [03-modelo-de-datos.md](./03-modelo-de-datos.md), [04-factura-cobro-y-pagos.md](./04-factura-cobro-y-pagos.md), [05-cotizacion.md](./05-cotizacion.md) y [`database/schema.sql`](../database/schema.sql), que se regenera desde las migraciones. En `05-cotizacion.md` se describe la serie `USD` del BCRA sin equipararla a la Com. A 3500, se usa `REF` como respaldo oficial y se aclara que la API omite fines de semana y feriados, responde 400 ante fechas futuras y exige `limit` entre 10 y 1000. La definición oficial de la serie `USD` está sin verificar.

### B. Recorrido vertical real (lo más importante)

**PR de base antes de repartir módulos.** `feature/organizations` es el molde de los tres módulos siguientes y hoy arrastra defectos que se replicarían. El primer día, Juanpi abre un PR de base que:

- Corrige el `validateQuery` copiado de `validateBody` (en Express 5 `req.query` no se puede asignar).
- Acepta `null` en `commercialAddress` y `grossIncomeNumber`, como define el contrato, y resuelve `taxCondition` (aceptarlo y validarlo, o quitarlo del contrato: decisión pendiente del equipo, se actualiza [08-contrato-api.md](./08-contrato-api.md) en el mismo PR).
- Valida fechas con ida y vuelta (hoy `2024-02-31` se convierte en 2 de marzo).
- Agrega la categoría por defecto "Cobro de facturas", que exigen [03-modelo-de-datos.md](./03-modelo-de-datos.md) y [04-factura-cobro-y-pagos.md](./04-factura-cobro-y-pagos.md).
- Traduce `P2025` a 404 en lugar de 500, unifica el idioma de los mensajes de error y mueve `recordAudit` dentro de la transacción en las operaciones con dinero.
- Suma helpers compartidos (`validateQuery`, `validateParams`, fechas, importes como string decimal), un `/health`, el andamiaje de pruebas contra una base de test y un CI mínimo.

Después de ese PR se mergea `feature/organizations` y recién entonces se reparten los módulos.

Cada módulo sigue la estructura de `backend/src/module/auth/` (`routes`, `controller`, `service`, `schemas`). Los endpoints son los del [contrato de la API](./08-contrato-api.md). Reglas comunes: cada consulta filtra por `organizationId`, un id de otra organización devuelve 404, el servicio verifica que `categoryId` y `clientId` pertenezcan a la organización, y cada módulo trae pruebas cruzadas entre dos organizaciones.

| Orden | Módulo | Issues | Responsable | Depende de |
| --- | --- | --- | --- | --- |
| 0 | PR de base (defectos de `feature/organizations`, helpers, pruebas, CI) | por crear | Juanpi | Nada |
| 1 | Organization (+ actividades y puntos de venta) | #25, #26, #27 | Juanpi y Nahuel | PR de base y bloque A |
| 2 | Client | #28, #29 | Brian | 1 |
| 2 | Category | #30 | Nahuel | 1 |
| 3 | Transaction | #31, #32 | Brian | 2 |
| 4 | Dashboard | #33 | Brian | 3 |
| 5 | Seeds de datos de prueba | #21 | Brian | 1 al 4 |

El dashboard del contrato ([08-contrato-api.md](./08-contrato-api.md)) hoy devuelve solo el resultado de caja, así que el #33 no depende de la decisión del #98. Esa decisión solo bloquea "facturado contra cobrado" (#53). Los importes viajan como strings decimales y el dashboard se calcula con un único `$queryRaw` parametrizado que redondea por fila (`ROUND(amount * exchange_rate, 2)`) antes de sumar.

**Retiro de mocks por módulo.** No se usa un `VITE_USE_MOCKS=false` global, porque rompería a quien todavía depende de un módulo sin mergear. El frontend lee una lista `VITE_MOCK_MODULES` y el PR que vuelve real un módulo borra su handler mock. **Organization y el `me-overlay` se retiran juntos**, porque los handlers mock de clientes y movimientos resuelven la organización desde la base mock, y los clientes mock deben seguir resolviéndola desde el token. Ese acoplamiento se infirió de dos archivos y no se leyó `handlers/context.ts`: sin verificar.

Cierre del bloque: `VITE_MOCK_MODULES` vacía y el flujo registro → organización → cliente → movimiento → dashboard funciona contra PostgreSQL. Un test de recorrido con supertest (registro → organización → cliente → movimiento → dashboard) es la definición ejecutable del cierre. Se actualizan las capturas del [README del frontend](../frontend/README.md#capturas) y la tabla de la segunda entrega del README.

### C. Invoice → Payment → Transaction

Es donde se prueba en código la separación entre factura, pago y movimiento. Va después del bloque B.

| Orden | Qué | Issues | Responsable |
| --- | --- | --- | --- |
| 1 | CRUD de facturas con ítems, estados y Factura C, sin ARCA. El snapshot del emisor se copia al pasar a PENDING, que se bloquea si falta la condición IVA del receptor | #45, #46, #48, #50 | Nahuel |
| 2 | Pago que genera un `Transaction`, con tope por saldo y bloqueo de la factura (ver [atomicidad](./02-atomicidad-concurrencia.md)) | #51 | Brian |
| 3 | Pantalla de pagos y dashboard de facturado contra cobrado | #52, #53 | Brian |
| 4 | Campos de CAE y PDF del comprobante | #54, #55 | Nahuel |

Aclaraciones del #51: el bloqueo es `SELECT ... FOR UPDATE` sobre la factura, filtrado por organización, bajo `READ COMMITTED`. La suma de pagos se compara con `Decimal`, no con `number`. El `$queryRaw` se tipa y trae la `currency` de la factura. Si se adopta el #98 recomendado, `registerPayment` acepta `adoptTransactionId`.

Los tests de concurrencia del pago (dos pagos simultáneos que juntos superan el total) son parte del criterio de cierre del #51. El test se repite o inyecta un retardo entre la lectura de la suma y el insert, porque sin eso la carrera puede no manifestarse y el test pasar por casualidad, y el pool de conexiones debe tener al menos dos.

### D. ARCA (corre en paralelo, lo lleva Juanpi)

Calendario alineado con [06-plan-b-arca.md](./06-plan-b-arca.md): certificado de homologación y ticket de acceso de WSAA el **12/10**, primera factura autorizada en homologación el **20/10**.

| Orden | Qué | Issue |
| --- | --- | --- |
| 1 | Conseguir el certificado de homologación. Si está bloqueado por algo externo, documentarlo en [06-plan-b-arca.md](./06-plan-b-arca.md) con fecha, mensaje y captura sin datos sensibles | #40 |
| 2 | WSAA: pedir el ticket de acceso | #41 |
| 3 | Primera llamada válida a WSFEv1 | #43 |
| 4 | Renovación automática del ticket | #42 |

"Primera llamada válida a WSFEv1" es `FECompUltimoAutorizado` autenticado (punto de venta y tipo de comprobante 11). `FEDummy` solo prueba conectividad, no el ticket, y su uso sin autenticación está sin verificar.

**CondicionIVAReceptorId desde ya.** Desde la RG 5616/2024 hay que informar la condición IVA del receptor, y se espera que ARCA rechace solicitudes sin ese dato desde el 01/12/2026 (fecha de fuentes secundarias, sin verificar). `ArcaClient` lo exige desde el principio, junto con `FEParamGetCondicionIvaReceptor` para validar los valores.

**Librería.** Primera opción: `facturas`, fijada a versión exacta, tras una **prueba corta de un día** con un script mínimo propio como control. Respaldo: `@afipsdk/afip.js`. Antes de adoptar cualquiera hay que verificar si acepta credenciales por organización y un caché de ticket externo (sin verificar para `facturas`), y si `@afipsdk/afip.js` envía el certificado a un servidor de terceros. Para los tests se usa el `ArcaClient` simulado. Si la prueba no sale, se sigue con el script propio detrás de `ArcaClient`. Detalle técnico en [06-plan-b-arca.md](./06-plan-b-arca.md).

Si el certificado no está, se activa el escalón 1 y se deja constancia en el `.md`. El resto de ARCA (#56 al #60) queda detrás de `ArcaClient` con la implementación simulada, como define el plan B.

### E. Relevamiento (lo lleva Juanpi)

#8 y #9 pasan a Juanpi. Mínimo 3 respuestas, 5 si se puede, con al menos un caso de cada variante (productos, servicios, ambos). Los tres participan de las entrevistas: uno pregunta y otro toma notas. No se recluta entre compañeros que conocen el proyecto. Se completa la tabla de [07-relevamiento.md](./07-relevamiento.md) y se escriben las conclusiones. No hay resultados todavía y no se completan hasta tenerlos.

Metodología: 20 a 25 minutos por entrevista, preguntas sobre hechos pasados, consentimiento verbal informado y anonimato (P1, P2, ...). Con tan pocas entrevistas no hay porcentajes: cada supuesto queda "confirmado" (3 de 5 muestran el comportamiento), "débil" (1 o 2) o "descartado" (0). Las preguntas que más pesan prueban pagos parciales, dólares, herramienta de facturación actual, tope de categoría y compromiso real.

### F. Orden del repositorio

- Abrir el PR de `feature/organizations` después del PR de base (bloque B).
- Cerrar #100 y revisar qué issues del frontend (#28 al #33) tienen la parte de UI hecha, y anotarlo en cada uno.
- Actualizar el README: la entrega 2 recibió la corrección y el estado del backend cambió.
- Configurar `user.email` de Git igual al verificado en GitHub, para que los commits se atribuyan a cada persona.

**Decisión pendiente: modelo de ramas.**

| Opción | Efecto |
| --- | --- |
| Gitflow con `develop` (como hoy en [10-guia-del-equipo.md](./10-guia-del-equipo.md)) | `Closes #n` solo funciona cuando el PR apunta a la rama por defecto, así que se usa en los releases `develop → main`, un `Closes` por línea. `develop` se protege con ruleset y el cierre automático del Project queda apagado para que Done signifique "llegó a `main`". Recrear `develop` según la [guía](./10-guia-del-equipo.md#recrear-develop) |
| GitHub flow: ramas cortas a `main` protegida con CI | `Closes #n` en cada PR y tag `entrega-3` como snapshot. No hace falta recrear `develop` |

Recomendación de la investigación: GitHub flow, salvo que [01-propuesta.md](./01-propuesta.md) (secciones 13 a 16) u Oscar exijan `develop`. No se revisó qué fija esa propuesta. Plazo: 12/10, antes del onboarding.

**Decisión pendiente: método de merge.** Opciones: merge commit, squash o rebase. Recomendación de la investigación: permitir solo "Create a merge commit", que conserva autoría y fecha por commit, y es la evidencia que toma Oscar. Plazo: 12/10.

Hasta que se decidan, los cambios de este plan que dependen de ellos (reglas de `Closes`, base de las ramas, ajustes de la guía del equipo) quedan sin aplicar.

## Plan día por día (12/10 al 25/10)

P0 es camino crítico, P1 absorbe holgura y P2 solo si sobra tiempo. Las responsabilidades respetan los bloques anteriores.

| Día | Prioridad | Foco | Entregable verificable |
| --- | --- | --- | --- |
| Lun 12/10 | P0 | Juanpi: control del plan B de ARCA (WSASS, CSR, certificado) o bloqueo documentado. Decidir modelo de ramas, método de merge y fecha real con Oscar. Los tres: levantar `./scripts/dev.sh` y anotar síntomas. Juanpi arma contactos y mensajes del relevamiento | Certificado o bloqueo fechado en `docs/06`. Decisiones registradas. Entornos corriendo |
| Mar 13/10 | P0 | Juanpi: PR de base. Decisión del #98. Nahuel, con Brian y Juanpi: rama de ajustes de modelo con la migración única. Onboarding de Git si se decidió el modelo de ramas | PR de base abierto. Decisión del #98 tomada. Rama de migración con esquema y SQL |
| Mié 14/10 | P0 | Merge del PR de base y de la migración de ajustes. Regenerar `database/schema.sql`. Organization real contra PostgreSQL. Juanpi: ticket WSAA con script mínimo y prueba de un día de la librería. 1 o 2 entrevistas | Migración y organización en la rama base. Ticket WSAA o bloqueo fechado |
| Jue 15/10 | P0 | Brian: Client (#28, #29). Nahuel: Category (#30). Juanpi: `FECompUltimoAutorizado`, `FEParamGetCondicionIvaReceptor` y retiro de mocks de Organization junto con `me-overlay` | Clientes y categorías reales con pruebas cruzadas entre organizaciones |
| Vie 16/10 | P0 | Brian: Transaction (#31, #32). Entrevistas hasta llegar a 3 cargadas. Juanpi: evidencia de ARCA (ticket sin datos sensibles y `FECompUltimoAutorizado`) | Movimientos reales. 3 entrevistas en `docs/07` |
| Sáb 17/10 | P1 | Buffer: PRs atrasados, `docs/05` corregido y metodología del relevamiento | PRs al día |
| Dom 18/10 | P2 | Sin trabajo planificado | n/a |
| Lun 19/10 | P0 | Brian: Dashboard (#33). Nahuel: facturas con ítems y estados (#45, #46, #48) | Dashboard contra PostgreSQL. Facturas en borrador |
| Mar 20/10 | P0 | Brian: seeds (#21) y prueba del recorrido sin mocks. Nahuel: Factura C sin ARCA y snapshot al pasar a PENDING (#50). Juanpi: primera factura autorizada en homologación (hito del plan B) o bloqueo fechado | Recorrido registro → dashboard sin mocks. CAE de prueba o bloqueo |
| Mié 21/10 | P0 | Brian: Payment → Transaction (#51) con `FOR UPDATE` y test de concurrencia. Nahuel: CAE y PDF (#54, #55) | Pago parcial en código. Test de dos pagos simultáneos que pasa |
| Jue 22/10 | P0 | Pantalla de pagos y facturado contra cobrado (#52, #53). Test de recorrido con supertest. README, capturas y `docs/03`, `docs/04`, `docs/08`. Abrir el último PR a `main` | CI verde. Documentos al día |
| Vie 23/10 | P0 | Revisión cruzada y merge de todo a `main` (cierre efectivo). Verificar el cierre de issues y el estado de #28 a #33 | `main` actualizada con fecha de commit anterior al límite |
| Sáb 24/10 | P1 | Solo correcciones menores y verificación en limpio (clonar, `./scripts/dev.sh`, recorrido) | Verificación en limpio |
| Dom 25/10 | P2 | Fecha asumida de entrega. Confirmar con Oscar | Entrega confirmada |

Regla de fondo: pushear seguido, un PR chico por issue, revisión de otra persona, nada de `.env`, claves ni certificados en el repo, y toda migración nueva avisada al equipo y creada por el autor único.

Regla de entrega: lo que no está pusheado y mergeado a `main` antes de la fecha no cuenta, porque Oscar toma la fecha de los commits. El PR final a `main` se abre dos días antes.

## Riesgos

| Riesgo | Qué hacemos |
| --- | --- |
| El certificado de ARCA no llega | Se documenta el bloqueo y se sigue con `ArcaClient` simulado. No frena a nadie |
| Dependencias entre módulos frenan a alguien | Cada uno arranca contra el contrato de la API y los mocks de su módulo hasta que el anterior esté mergeado |
| Conflictos de migraciones entre ramas | Una sola migración de ajustes con autor único. Después, toda migración nueva la crea ese autor y se mergea en 24 horas |
| Los defectos de `feature/organizations` se copian a los demás módulos | El PR de base se mergea antes de repartir módulos |
| Seguir invirtiendo en docs y mocks | Ningún `.md` nuevo salvo que una decisión de código lo pida |

## Definition of Done de la entrega 3

- [ ] Ajustes de modelo de Oscar aplicados: esquema, migración, `schema.sql` y docs al día.
- [ ] Flujo usuario → organización → cliente → movimiento → dashboard sin mocks, sobre PostgreSQL, con un test de recorrido.
- [ ] Pago parcial funcionando en código, con Payment y Transaction en la misma transacción de base de datos.
- [ ] Relevamiento con al menos 3 respuestas y conclusiones.
- [ ] ARCA: evidencia del spike (ticket WSAA y `FECompUltimoAutorizado` autenticado) o bloqueo documentado.
- [ ] Todo en `main`, con README y capturas actualizados.
