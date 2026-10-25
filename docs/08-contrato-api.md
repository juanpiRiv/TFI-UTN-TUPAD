# Contrato esperado de la API

Este documento describe los endpoints que el frontend espera del backend para el recorrido de la segunda entrega: usuario, organización, cliente, movimiento y dashboard.

Hoy el backend (PR #90) solo tiene autenticación. El resto lo simulamos en el frontend con MSW (ver [`frontend/README.md`](../frontend/README.md#mocks)), siguiendo exactamente este contrato. Cuando el backend implemente un endpoint, alcanza con borrar su handler de `frontend/src/mocks/handlers/`: las pantallas no cambian.

Los nombres de los campos salen del [modelo de datos](./03-modelo-de-datos.md), pasados a camelCase como los devuelve Prisma (`legal_name` pasa a ser `legalName`). Si algo no está definido en el modelo, lo dejamos como pregunta al final en vez de inventarlo.

## Convenciones

- Todas las rutas empiezan con `/api` y reciben y devuelven JSON.
- Las rutas privadas piden el encabezado `Authorization: Bearer <token>`. Sin token o con uno inválido, responden `401`.
- Toda consulta filtra por la organización del usuario logueado (RNF-04). Si se pide un `id` de otra organización, la respuesta es `404`, igual que si no existiera.
- **Importes:** viajan como string decimal, por ejemplo `"1500.50"`, y nunca como número, para no perder precisión. Los tipos de cambio también son string, con hasta 6 decimales (`"1447.500000"`).
- **Fechas sin hora** (`transactionDate`, `activityStartDate`, filtros `from` y `to`): se mandan como `YYYY-MM-DD`. Prisma serializa las columnas `@db.Date` como `2026-09-10T00:00:00.000Z`. El frontend acepta los dos formatos, porque solo toma los primeros 10 caracteres.
- **Fechas con hora** (`createdAt`, `updatedAt`, `voidedAt`): van en ISO 8601.

### Errores

Todos los errores usan el formato que ya tiene el backend en `middlewares/error-handler.ts`:

```json
{ "error": "invalid Data", "details": [{ "field": "amount", "message": "Amount must be greater than zero" }] }
```

`details` es opcional. Aparece en los errores de validación (`400`) y en los `409` que se pueden atribuir a un campo (por ejemplo, un CUIT ya registrado). El frontend muestra `error` arriba del formulario y cada `details[].message` debajo del campo que indica `field`.

| Código | Cuándo |
| --- | --- |
| `400` | Datos inválidos. Trae `details`. |
| `401` | Falta el token o es inválido. El frontend cierra la sesión y vuelve al login. |
| `403` | El usuario todavía no creó su organización y pide algo que la necesita. |
| `404` | No existe, o es de otra organización. |
| `409` | Choca con un dato único (CUIT, documento del cliente, nombre de categoría), la organización ya existe o la operación no está permitida por el estado de los datos (por ejemplo, cambiar el CUIT con facturas autorizadas). Puede traer `details`. |

## Autenticación (ya existe en el backend)

| Método y ruta | Request | Response |
| --- | --- | --- |
| `POST /api/auth/register` | `{ email, password }` | `201` `{ user: { id, name, email, createdAt }, token }`. `409` si el email ya existe. |
| `POST /api/auth/login` | `{ email, password }` | `200` `{ user, token }`, con `user` igual que en el registro. `401` si el email o la contraseña no coinciden. |
| `GET /api/auth/me` | | `200` `{ id, name, email, createdAt, organization }`. `name` es `null` hasta que el usuario lo carga en su perfil; `organization` es `null` hasta que hace el onboarding. |

El frontend usa `organization` de `/me` para decidir si el usuario puede entrar a la app o tiene que pasar primero por `/onboarding`.

## Perfil de usuario

Cubre RF-04. Las rutas usan `me` porque siempre se modifica el usuario del token.

| Método y ruta | Request | Response |
| --- | --- | --- |
| `PATCH /api/users/me` | `{ name?, email?, currentPassword? }` | `200` `{ id, name, email, createdAt, updatedAt }`. `409` si el email ya lo usa otro usuario. |
| `PATCH /api/users/me/password` | `{ currentPassword, newPassword }` | `204` sin contenido. |

- `name` es opcional; `null` lo borra. Tiene que venir `name`, `email` o los dos.
- Cambiar el `email` exige `currentPassword`. Si no viene o es incorrecta, responde `400` con `details` en el campo `currentPassword`.
- `newPassword` tiene entre 8 y 128 caracteres y tiene que ser distinta de la actual.
- **Una contraseña actual incorrecta responde `400`, no `401`.** El frontend cierra la sesión ante cualquier `401` con token, y en este caso el usuario solo se equivocó al tipear.
- Ninguno de los dos cambios invalida el token: la sesión sigue abierta.

## Organización

La organización es del usuario logueado, por eso las rutas usan `me` en lugar de un `id`. Cubre RF-05 y RF-06.

| Método y ruta | Request | Response |
| --- | --- | --- |
| `POST /api/organizations` | Ver cuerpo abajo | `201` con la organización. Crea también las categorías por defecto y el punto de venta N° 1 (sin él no se pueden crear facturas), y registra el alta en la auditoría. `400` si algún campo no es válido. `409` si el usuario ya tiene una o si el CUIT ya está registrado. `401` si el usuario del token ya no existe. |
| `GET /api/organizations/me` | | `200` con la organización. `403` si todavía no tiene. |
| `PATCH /api/organizations/me` | Cualquier campo del cuerpo de alta | `200` con la organización actualizada. `400` si algún campo no es válido. `403` si todavía no tiene organización. `409` si el CUIT ya está registrado o si se intenta cambiar con facturas autorizadas. |

Cuerpo de alta:

```json
{
  "cuit": "20123456786",
  "legalName": "Lucía Pérez",
  "tradeName": "Estudio Lucía Diseño",
  "commercialAddress": null,
  "taxCondition": "MONOTRIBUTO",
  "monotributoCategory": "B",
  "activityStartDate": "2024-03-01",
  "grossIncomeNumber": null,
  "baseCurrency": "ARS"
}
```

- `cuit`: 11 dígitos sin guiones, con el dígito verificador válido.
- `legalName`, `taxCondition` y `baseCurrency` son obligatorios. En el P0, `baseCurrency` es siempre `ARS` (#96). `taxCondition` es `MONOTRIBUTO`, `RESPONSABLE_INSCRIPTO` o `EXENTO`; `CONSUMIDOR_FINAL` solo aplica a clientes.
- `activityStartDate` es opcional; si viene, tiene que ser desde el 1900-01-01 y no puede ser una fecha futura.
- Los `409` por CUIT (ya registrado, o cambio con facturas autorizadas) traen `details` con el campo `cuit`, para mostrar el error debajo del input.

## Clientes

Cubre RF-07 a RF-11. La baja es lógica (RN-12).

| Método y ruta | Request | Response |
| --- | --- | --- |
| `GET /api/clients?search=&includeInactive=` | | `200` con la lista, ordenada por nombre. Sin `includeInactive=true`, solo trae los activos. `search` busca en nombre, número de documento y email. |
| `GET /api/clients/:id` | | `200` con el cliente, aunque esté dado de baja. |
| `POST /api/clients` | Ver cuerpo abajo | `201` con el cliente. `409` si ya hay otro con el mismo tipo y número de documento. |
| `PATCH /api/clients/:id` | Cualquier campo del cuerpo, o `{ "isActive": false }` para darlo de baja | `200` con el cliente. |

```json
{
  "name": "Café Aroma SRL",
  "docType": "CUIT",
  "docNumber": "30712345671",
  "taxCondition": "RESPONSABLE_INSCRIPTO",
  "email": "compras@cafearoma.com",
  "phone": null,
  "address": null
}
```

- Solo `name` es obligatorio. `docType` es uno de `CUIT`, `CUIL`, `DNI`, `PASAPORTE` o `SIN_IDENTIFICAR`, y `taxCondition` es uno de `RESPONSABLE_INSCRIPTO`, `MONOTRIBUTO`, `EXENTO` o `CONSUMIDOR_FINAL`.
- El historial del cliente se consulta con `GET /api/transactions?clientId=<id>`.

## Categorías

Cubre RF-14. Cada categoría es de ingreso o de egreso, nunca de los dos tipos.

| Método y ruta | Request | Response |
| --- | --- | --- |
| `GET /api/categories?type=&includeInactive=` | | `200` con la lista ordenada por nombre. `type` es `INCOME` o `EXPENSE`. |
| `POST /api/categories` | `{ name, type }` | `201` con la categoría. `409` si ya existe una con el mismo nombre y tipo. |
| `PATCH /api/categories/:id` | `{ name }` o `{ isActive }` | `200` con la categoría. El `type` no se puede cambiar (`400`), porque dejaría movimientos con una categoría del otro tipo. |

La respuesta es `{ id, organizationId, name, type, isActive, createdAt, updatedAt }`.

Al crear la organización se crean estas categorías. "Cobro de facturas" la pide el modelo de datos. Las demás son una propuesta:

| Ingresos | Egresos |
| --- | --- |
| Cobro de facturas, Ventas, Otros ingresos | Alquiler, Servicios contratados, Impuestos, Otros egresos |

## Movimientos

Cubre RF-12, RF-13, RF-15, RF-16 y RF-17, con las reglas RN-01 a RN-06.

| Método y ruta | Request | Response |
| --- | --- | --- |
| `GET /api/transactions?from=&to=&type=&categoryId=&clientId=` | | `200` con la lista de movimientos no anulados, del más nuevo al más viejo. Todos los filtros son opcionales y se combinan. `from` y `to` incluyen los extremos. |
| `POST /api/transactions` | Ver cuerpo abajo | `201` con el movimiento. |

```json
{
  "type": "INCOME",
  "amount": "500.00",
  "currency": "USD",
  "exchangeRate": "1447.5",
  "categoryId": 12,
  "clientId": 3,
  "transactionDate": "2026-09-26",
  "description": "Sitio web para cliente del exterior"
}
```

Validaciones del backend (el frontend hace las mismas antes de enviar):

- `amount` mayor a cero, con hasta 2 decimales (RN-03).
- `currency` obligatoria, `ARS` o `USD` (RN-04).
- `exchangeRate` obligatorio si `currency` no es la moneda base de la organización, mayor a cero y con hasta 6 decimales (RN-05). Si la moneda es la base, se guarda `null`. El valor que manda el usuario se guarda como copia (RN-06).
- `categoryId` tiene que ser una categoría activa de la organización, del mismo tipo que el movimiento.
- `clientId` es opcional. Si viene, tiene que ser un cliente de la organización.

Cada movimiento de la respuesta trae, además de sus campos, la categoría y el cliente para mostrarlos sin otro pedido:

```json
{
  "id": 40,
  "organizationId": 1,
  "paymentId": null,
  "categoryId": 12,
  "clientId": 3,
  "type": "INCOME",
  "amount": "500.00",
  "currency": "USD",
  "exchangeRate": "1447.500000",
  "transactionDate": "2026-09-26",
  "description": "Sitio web para cliente del exterior",
  "voidedAt": null,
  "createdAt": "2026-09-26T16:25:10.000Z",
  "updatedAt": "2026-09-26T16:25:10.000Z",
  "category": { "id": 12, "name": "Ventas", "type": "INCOME" },
  "client": { "id": 3, "name": "Juan Rodríguez" }
}
```

## Facturas

Cubre RF-22 y RF-23. El backend crea facturas en borrador, las consulta y las autoriza con el proveedor fiscal que indique `ARCA_PROVIDER` (hoy se prueba con el simulado).

| Endpoint | Cuerpo | Respuesta |
| --- | --- | --- |
| `GET /api/invoices` | | `200` con la lista de facturas de la organización, de la más nueva a la más vieja: `id`, `voucherType`, `voucherNumber`, `concept`, `issueDate`, `recipientName`, `currency`, `totalAmount`, `totalPaid`, `pendingBalance`, `status`, `commercialStatus`, `cae` y `client`. |
| `GET /api/invoices/:invoiceId` | | `200` con el detalle: lo de la lista más `items`, `payments` (los no anulados), `issuer` y `simulated`. `404` si no existe en la organización. |
| `POST /api/invoices` | Ver abajo | `201` con la factura en estado `DRAFT` y la misma forma que `GET /api/invoices/:id` (con `invoiceId`, `items`, `totalPaid` en `0.00` y `payments` vacío). `400` si algún campo no es válido o no hay ítems. `404` si el cliente o el punto de venta no existen en la organización. `409` si el cliente está dado de baja. `403` si todavía no hay organización. |
| `POST /api/invoices/:invoiceId/authorize` | Sin cuerpo | `200` con `{ invoice, fiscal }`: `invoice` tiene la forma del detalle y `fiscal` trae `outcome` (`AUTHORIZED`, `AUTHORIZED_WITH_OBSERVATIONS` o `REJECTED`), `simulated`, `observations` y `errors`. `202` si ARCA no respondió (`INDETERMINATE`) y la factura queda `PENDING`. `409` si no está en borrador. `404` si no existe. `502` si falló la comunicación y quedó `PENDING`. `503` si el proveedor fiscal no se pudo armar (la factura no se toca). |

```json
{
  "pointOfSaleId": 1,
  "clientId": 7,
  "concept": "SERVICIOS",
  "issueDate": "2026-10-24",
  "serviceFrom": "2026-10-01",
  "serviceTo": "2026-10-31",
  "paymentDueDate": "2026-11-23",
  "items": [{ "description": "Consultoría técnica", "quantity": 1, "unitPrice": 250000 }]
}
```

Cómo autoriza (docs/02, sección 4): reserva el borrador (`DRAFT` → `PENDING`) con la fila bloqueada; después, de a una por punto de venta, calcula el número (el mayor entre el último del proveedor y el último autorizado en la base, más uno), pide el CAE y guarda `AUTHORIZED` con `voucher_number`, `cae` y `cae_expiration`, o `REJECTED` con los errores en `arca_response`. Registra `invoice.authorized` o `invoice.rejected` en la auditoría. Una factura `PENDING` no se reintenta sola: la reconciliación todavía no está hecha.

- `pointOfSaleId` es opcional: si falta se usa el primer punto de venta activo. `clientId` es opcional: sin cliente se emite como consumidor final.
- `concept` es `PRODUCTOS`, `SERVICIOS` o `PRODUCTOS_Y_SERVICIOS`. Si incluye servicios, `serviceFrom`, `serviceTo` y `paymentDueDate` son obligatorias.
- `voucherType` (solo `FACTURA_C`) y `currency` (solo `ARS`) son opcionales y valen eso por defecto en el P0.
- El total y los subtotales los calcula siempre el backend (`cantidad × precio`, redondeado a dos decimales); si el cuerpo trae un total, se ignora. Cantidad hasta 3 decimales y mayor a cero, precio hasta 2 decimales y no negativo, total mayor a cero.
- La factura guarda una copia del nombre, documento y condición frente al IVA del cliente. Al facturar (`authorize`) guarda también una copia de los datos del emisor, que el detalle devuelve en `issuer` (`cuit`, `legalName`, `tradeName`, `address`, `taxCondition`, `grossIncomeNumber`, `activityStartDate`); es `null` mientras sea borrador. El detalle devuelve además `simulated`: `true` si la autorizó el proveedor simulado (el CAE no tiene validez fiscal y la pantalla lo avisa) y `false` en cualquier otro caso; sale de `arca_response.simulated`. Se registra `invoice.created` en la auditoría.

## Cobros

Cubre RF-29 y RF-30. Reglas en [Factura, cobro y pagos parciales](./04-factura-cobro-y-pagos.md). Los pagos cuelgan de una factura y solo se pueden registrar sobre facturas `AUTHORIZED`.

| Endpoint | Cuerpo | Respuesta |
| --- | --- | --- |
| `GET /api/invoices/:invoiceId/payments` | | `200` con los pagos de la factura, su saldo y su estado comercial. `404` si la factura no existe. |
| `POST /api/invoices/:invoiceId/payments` | Ver abajo | `201` con `{ payment, transaction, invoiceSummary }`. `404` si la factura o el movimiento a adoptar no existen. `422` si la factura no está autorizada, si la moneda del pago no es la de la factura, si la fecha es futura o anterior a la emisión, si el pago supera el saldo, o si el movimiento a adoptar no sirve (ya está vinculado, no es ingreso, o importe o moneda distintos). `400` si algún campo no es válido. |

```json
{ "amount": "100000.00", "paymentDate": "2026-10-24", "currency": "ARS", "description": "Primera cuota", "adoptTransactionId": 12 }
```

- `amount` es un texto decimal mayor a cero con hasta 2 decimales; `paymentDate` es `AAAA-MM-DD`. `currency` vale `ARS` por defecto y tiene que coincidir con la de la factura (en el P0 todas son ARS). `description` y `adoptTransactionId` son opcionales.
- Con `adoptTransactionId` el cobro **adopta** un ingreso manual que ya estaba cargado, en vez de crear otro, para que el mismo ingreso no se cuente dos veces. Sin él se crea el movimiento de ingreso con la categoría "Cobro de facturas".
- La respuesta trae el pago, el movimiento que le corresponde y el resumen de la factura (`totalAmount`, `totalPaid`, `pendingBalance` y `commercialStatus`: `PENDING`, `PARTIALLY_PAID` o `PAID`).
- El saldo se controla dentro de una transacción con la factura bloqueada (`SELECT ... FOR UPDATE`): dos cobros simultáneos que juntos superan el saldo, entra uno solo.

## Salud del servicio

| Endpoint | Respuesta |
| --- | --- |
| `GET /health` | `200` con `{ "status": "ok" }`, sin autenticación y sin tocar la base. Lo usa el healthcheck de Railway. |

## Cotización sugerida

Sirve para proponer el tipo de cambio cuando el movimiento es en dólares. El usuario lo puede cambiar. La fuente y la regla de la fecha están en [Cotización](./05-cotizacion.md).

| Método y ruta | Response |
| --- | --- |
| `GET /api/exchange-rates/usd?date=YYYY-MM-DD` | `200` `{ date, observedAt, value, source, rateType }`. `observedAt` es el día hábil del que sale el valor, que puede ser anterior a `date`. `404` o `503` si no hay ninguna cotización guardada. |

```json
{ "date": "2026-09-26", "observedAt": "2026-09-25", "value": "1447.500000", "source": "BCRA", "rateType": "ESTADISTICAS_CAMBIARIAS" }
```

Si este endpoint falla, el formulario igual deja cargar el movimiento con el tipo de cambio escrito a mano.

## Dashboard

Cubre RF-31 y RF-32. Por ahora solo el resultado de caja, porque todavía no hay facturas (ver [Factura, cobro y pagos](./04-factura-cobro-y-pagos.md#resultado-de-gestión-y-resultado-de-caja)).

| Método y ruta | Response |
| --- | --- |
| `GET /api/dashboard/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | `200` con el resumen del período. `400` si falta una fecha o si `from` es posterior a `to`. |

```json
{
  "from": "2026-09-01",
  "to": "2026-09-30",
  "currency": "ARS",
  "income": "918750.00",
  "expense": "92500.50",
  "net": "826249.50",
  "transactionCount": 5,
  "byCategory": [
    { "categoryId": 12, "name": "Ventas", "type": "INCOME", "total": "873750.00" },
    { "categoryId": 15, "name": "Alquiler", "type": "EXPENSE", "total": "80000.00" }
  ]
}
```

- Suma los movimientos no anulados cuya `transactionDate` está dentro del período.
- Todo va en la moneda base (`currency`). Los movimientos en otra moneda se convierten con el `exchangeRate` guardado en cada uno, redondeando a 2 decimales.
- `net` es `income` menos `expense`, y puede ser negativo (`"-1500.00"`).
- El frontend no suma ni convierte: muestra estos valores tal como llegan.

## Preguntas abiertas

1. **Baja de clientes:** proponemos `PATCH` con `{ "isActive": false }`. ¿Preferimos un `DELETE /api/clients/:id` que haga la baja lógica?
2. **Paginación:** las listas de clientes y movimientos vienen completas. ¿Paginamos desde ahora (`page`, `pageSize`) o cuando haya volumen?
3. ~~**Categorías por defecto:** además de "Cobro de facturas", ¿cuáles creamos?~~ **Resuelta:** se crean las 7 de la tabla de arriba, en la misma transacción que la organización.
4. ~~**Organización pendiente:** ¿`403` es el código correcto cuando el usuario todavía no tiene organización?~~ **Resuelta:** sí, `403`. Todos los módulos la obtienen con `getUserOrganization` (`lib/organization.ts`).
5. ~~**Movimientos en USD con moneda base USD:** ¿Limitamos la moneda base a `ARS` en el P0?~~ **Resuelta:** sí, la moneda base es siempre `ARS` en el P0 (#96).
6. **Anulación de movimientos:** el modelo tiene `voidedAt`, pero no definimos el endpoint. ¿`POST /api/transactions/:id/void`?
7. **Formato de fechas:** ¿el backend devuelve `transactionDate` como `YYYY-MM-DD` o deja el formato de Prisma con hora?
