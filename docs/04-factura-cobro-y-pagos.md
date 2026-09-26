# Factura, cobro y pagos parciales

Uno de los puntos que nos marcó la cátedra es dejar bien claro qué diferencia hay entre facturar y cobrar, y qué pasa cuando un cliente paga en partes. Acá dejamos las reglas que acordamos los tres, con ejemplos con números para que no haya dudas a la hora de programar.

## Tres cosas distintas

En el sistema conviven tres conceptos que en la vida real suelen mezclarse:

- **La factura (Invoice)** es el comprobante fiscal. Dice que le vendimos algo a alguien por un importe. Emitirla no significa que entró plata.
- **El pago (Payment)** es cada vez que el cliente nos paga, total o parcialmente, una factura. Una factura puede tener varios pagos.
- **El movimiento (Transaction)** es la entrada o salida de dinero que ve el usuario en su caja. Es lo que usa el dashboard para calcular ingresos, egresos y resultado.

La regla central es esta: **cada pago genera exactamente un movimiento de ingreso, y la factura por sí sola no genera ninguno.** Así el mismo ingreso nunca se cuenta dos veces.

También puede haber movimientos que no tienen nada que ver con una factura: un gasto, un ingreso en efectivo que no se facturó, un aporte propio. Esos se cargan a mano.

## Estados de una factura

Una factura tiene dos estados que avanzan por separado.

El **estado fiscal** dice en qué situación está ante ARCA:

| Estado | Qué significa | Se puede editar | Se puede cobrar |
| --- | --- | --- | --- |
| `DRAFT` | Borrador, todavía no se mandó a ARCA | Sí | No |
| `PENDING` | Se mandó y estamos esperando o confirmando la respuesta | No | No |
| `AUTHORIZED` | ARCA la aprobó y tiene CAE | No, nunca más (RN-11) | Sí |
| `REJECTED` | ARCA la rechazó. Se guardan las observaciones | Vuelve a borrador para corregir | No |

El **estado comercial** dice cuánto se cobró, y solo tiene sentido cuando la factura está autorizada. No se guarda en la base: se calcula cada vez a partir de los pagos no anulados, así nunca queda desfasado.

| Estado | Condición |
| --- | --- |
| Pendiente | No hay pagos |
| Cobrada en parte | Hay pagos, pero suman menos que el total |
| Cobrada | Los pagos suman exactamente el total |

El saldo pendiente (RF-30) es el total menos la suma de los pagos no anulados.

## Reglas

1. Solo se pueden registrar pagos sobre facturas `AUTHORIZED`. Cobrar un borrador no tiene sentido porque todavía no existe fiscalmente.
2. Cada pago tiene que ser mayor a cero, y la suma de los pagos no anulados nunca puede superar el total de la factura. Si alguien intenta pagar de más, el sistema lo rechaza e informa el saldo.
3. Registrar un pago crea en la misma operación el `Payment` y su `Transaction` de ingreso, con la categoría "Cobro de facturas". Si una de las dos cosas falla, no se guarda ninguna.
4. El movimiento que genera un pago no se edita ni se borra por separado. Si el pago estuvo mal, se anula el pago, y eso anula también su movimiento.
5. Anular es lógico: se completa `voided_at` y el registro queda en la base para la trazabilidad. Nada se borra físicamente.
6. La fecha que cuenta para la caja es la del pago, no la de la factura. Una factura de septiembre cobrada en octubre suma como facturado en septiembre y como cobrado en octubre.
7. Una factura autorizada no se modifica ni se anula dentro del sistema. Si tiene un error, el camino legal es una nota de crédito. Las notas de crédito quedan para P1 (ver [plan B](./06-plan-b-arca.md)), así que en el P0 el sistema solo muestra el aviso.
8. Al crear la factura se copian los datos del receptor (nombre, documento, condición frente al IVA). Si después se edita o se da de baja el cliente, las facturas viejas siguen mostrando los datos con los que se emitieron.
9. El total lo calcula siempre el backend sumando los ítems. Lo que manda el frontend como total se ignora.

## Ejemplo con pagos parciales

Lucía es diseñadora, monotributista, y le hace un logo a un cliente por $100.000. Le emite una Factura C el 10/09 y el cliente le paga en dos partes.

| Fecha | Qué pasa | Factura | Pagos | Movimientos | Estado comercial | Saldo |
| --- | --- | --- | --- | --- | --- | --- |
| 10/09 | Emite la factura y ARCA la autoriza | $100.000 | ninguno | ninguno | Pendiente | $100.000 |
| 15/09 | El cliente le transfiere $40.000 | $100.000 | $40.000 | ingreso $40.000 | Cobrada en parte | $60.000 |
| 20/09 | Intenta registrar $70.000 por error | sin cambios | rechazado | sin cambios | Cobrada en parte | $60.000 |
| 03/10 | Le pagan los $60.000 restantes en efectivo | $100.000 | $40.000 + $60.000 | ingreso $60.000 | Cobrada | $0 |

Lo que ve Lucía en el dashboard:

| Período | Facturado | Cobrado |
| --- | --- | --- |
| Septiembre | $100.000 | $40.000 |
| Octubre | $0 | $60.000 |

Si el 04/10 se da cuenta de que el pago del 03/10 lo cargó dos veces, no puede, porque el segundo supera el saldo. Y si hubiera cargado mal el importe, anula ese pago y lo vuelve a cargar: el movimiento se anula junto con el pago y la factura vuelve a figurar como cobrada en parte.

## Resultado de gestión y resultado de caja

En la propuesta hablamos de "resultado de gestión o de caja". Son dos números distintos y el dashboard muestra los dos:

- **Resultado de caja** del período = ingresos cobrados menos egresos. Suma todos los movimientos no anulados del período: los que vienen de pagos y los cargados a mano. Responde a la pregunta "¿cuánta plata me quedó?".
- **Resultado de gestión** del período = lo facturado (facturas autorizadas, por fecha de emisión) más los ingresos cargados a mano que no vienen de un pago, menos los egresos. Responde a "¿cuánto vendí y cuánto gasté?", aunque todavía no haya cobrado todo.

En el ejemplo de Lucía, si en septiembre gastó $15.000 en software:

- Resultado de caja de septiembre: $40.000 menos $15.000 = $25.000.
- Resultado de gestión de septiembre: $100.000 menos $15.000 = $85.000.

La diferencia entre los dos ($60.000) es justamente lo que le deben, y el dashboard lo muestra como "pendiente de cobro" (RF-33).

## Concepto de la factura

ARCA pide que cada factura diga si es por productos (1), servicios (2) o productos y servicios (3). Si incluye servicios, además hay que informar desde y hasta cuándo se prestó el servicio y el vencimiento del pago.

La regla que usamos:

1. El concepto se elige a nivel factura, no por ítem.
2. Por defecto se propone según las actividades activas de la organización: si todas son de productos (`GOODS`), `PRODUCTOS`; si todas son de servicios (`SERVICES`), `SERVICIOS`; si tiene de los dos tipos, se propone la de la actividad principal y el usuario puede cambiarlo a cualquiera de los tres.
3. Si el concepto incluye servicios (`SERVICIOS` o `PRODUCTOS_Y_SERVICIOS`), el formulario pide las fechas del servicio y el vencimiento del pago. Por defecto propone el mes de la fecha de la factura y el vencimiento a 30 días, y el usuario puede cambiarlos. Sin esas fechas no se puede pedir la autorización.

Si ARCA se atrasa, el caso de productos y servicios juntos puede pasar a P1 (ver [plan B](./06-plan-b-arca.md)).

## Quién aplica cada regla

Las reglas de negocio de la [propuesta](./01-propuesta.md#15-reglas-de-negocio) y las de este documento se validan en el backend, en el módulo que es dueño de la entidad. Varias además tienen una restricción en la base como respaldo (ver [modelo de datos](./03-modelo-de-datos.md#restricciones-en-la-base-de-datos)).

| Regla | Módulo | Respaldo en la base |
| --- | --- | --- |
| RN-01 Todo movimiento pertenece a una organización | `transactions` | `organization_id` obligatorio |
| RN-02 Tipo `INCOME` o `EXPENSE` | `transactions` | Enum |
| RN-03 Importes no negativos | `transactions`, `payments`, `invoices` | `CHECK` |
| RN-04 Moneda obligatoria | `transactions`, `payments` | Columna obligatoria |
| RN-05 Tipo de cambio si la moneda no es la base | `transactions`, `exchange-rates` | `CHECK` |
| RN-06 Cambiar la cotización no toca movimientos viejos | `exchange-rates` | El movimiento guarda una copia del valor |
| RN-07 Al menos un ítem por factura | `invoices` | Validación en el servicio |
| RN-08 Una factura rechazada no queda autorizada | `arca` | `CHECK` entre estado y CAE |
| RN-09 CAE solo en facturas autorizadas | `arca` | `CHECK` entre estado y CAE |
| RN-10 Facturado y cobrado son independientes | `payments`, `dashboard` | Tablas separadas |
| RN-11 Una factura autorizada no se borra | `invoices` | `ON DELETE RESTRICT` en pagos, y el servicio solo borra borradores |
| RN-12 Baja lógica de clientes con historial | `clients` | `is_active` |
| RN-13 Fecha y hora de cada consulta al BCRA | `exchange-rates` | `created_at` |
| RN-14 Credenciales fuera del código | `arca`, configuración | `.gitignore` y clave privada cifrada |
| Los pagos no superan el total de la factura | `payments` | Bloqueo de la factura al registrar (ver [atomicidad](./02-atomicidad-concurrencia.md)) |
| Un pago genera como máximo un movimiento | `payments` | Único en `transactions.payment_id` |

## Moneda

En el P0 las facturas se emiten en pesos. Los movimientos manuales sí pueden cargarse en dólares, y en ese caso guardan el tipo de cambio que se usó. Cómo se elige esa cotización está en [Cotización](./05-cotizacion.md).
