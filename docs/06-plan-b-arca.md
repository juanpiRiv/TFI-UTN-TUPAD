# Plan B si ARCA se atrasa

La integración con ARCA es la parte más incierta del proyecto: depende de conseguir el certificado de homologación, de entender bien WSAA y WSFEv1, y de que los servicios de prueba estén disponibles. Por eso decidimos de antemano qué hacemos si se complica, en lugar de improvisar sobre la fecha.

## Qué hacemos para bajar el riesgo desde ahora

- **El spike de ARCA arranca ya y lo lleva una sola persona**, en paralelo con el resto del desarrollo (fase 5 del [backlog](./BACKLOG.md), que no es la misma numeración que las fases del roadmap). La idea es tener lo antes posible un ticket de WSAA y una primera llamada válida a WSFEv1 en homologación.
- **ARCA queda aislada detrás de una interfaz propia** (`ArcaClient`) con dos implementaciones: la real, que habla con los web services de homologación, y una simulada, que responde como ARCA (CAE de prueba, rechazos, timeouts). El resto del sistema no sabe con cuál está hablando. Así la facturación se puede desarrollar y probar sin depender de ARCA, y si ARCA se atrasa no frena a nadie.
- **La factura existe sin ARCA.** El borrador, los ítems, los totales, el PDF y los pagos no dependen de tener CAE. Lo único que agrega ARCA es la autorización.

## Librería y spike

**Decisión propuesta** (a confirmar por el equipo después de la prueba):

1. **Primera opción: `facturas`**, fijada a versión exacta (el paquete sigue en 0.x), tras una prueba contra homologación (estimada en un día, estimación propia sin validar). Es local (no pasa por un servicio de terceros) y su resultado `indeterminate` y su método `recover()` se parecen a nuestro estado PENDING y a la reconciliación.
2. **Respaldo: `@afipsdk/afip.js`**, si `facturas` no sirve para nuestro diseño. Sin verificar: si exige un `access_token` de Afip SDK y si envía el certificado o la clave a su servidor. Hay que revisarlo antes de adoptarlo.
3. **Script propio mínimo (WSAA + CMS + SOAP)**: solo como control, acotado y en paralelo. Sirve para separar un problema de certificado de un problema de código.

Sin verificar de `facturas`: que acepte credenciales por organización, un almacén de ticket de acceso propio y `CondicionIVAReceptorId`. La prueba de un día tiene que responder esto. Sea cual sea la librería, queda detrás de `ArcaClient` y la numeración sigue calculándose bajo nuestro lock (ver [atomicidad y concurrencia](./02-atomicidad-concurrencia.md)).

**Aclaraciones:**

- "Primera llamada válida a WSFEv1" se entiende como un `FECompUltimoAutorizado` autenticado (con el ticket de WSAA) que devuelve el último número autorizado, no solo un `FEDummy`, que no requiere autenticación.
- `CondicionIVAReceptorId` se envía siempre, desde ahora. Los códigos válidos se consultan con `FEParamGetCondicionIvaReceptor`. La fecha desde la cual ARCA rechaza solicitudes sin ese campo (01/12/2026) surge de fuentes secundarias y está sin verificar contra el sitio de ARCA.

### Registro del spike

Se completa solo con datos reales, en el momento en que ocurren. Si un paso se bloquea, se anota el mensaje de error textual.

| Fecha | Paso | Resultado | Evidencia |
| --- | --- | --- | --- |
|  |  |  |  |

### Evidencia a guardar (sin credenciales)

- Captura del escritorio de ARCA con el servicio de autogestión de certificados de homologación visible, con CUIT y nombre tapados, y fecha.
- Si hay un bloqueo: texto del error, fecha y hora, pasos intentados.
- Comandos de `openssl` usados con valores ficticios, huella SHA-256 del certificado (no el certificado ni la clave) y su fecha de vencimiento.
- Captura de la autorización del servicio `wsfe` para el certificado, con el CUIT tapado.
- `LoginTicketRequest` de ejemplo sin firma y respuesta de WSAA con token y sign redactados (solo longitud y `expirationTime`).
- Prueba del caché del ticket: la segunda llamada dentro de las 12 horas no pide uno nuevo; y el error `coe.alreadyAuthenticated` provocado a propósito, anotando que el certificado queda sin ticket nuevo por unos minutos.
- Respuestas de `FEDummy` y de `FECompUltimoAutorizado` (punto de venta, tipo de comprobante 11, número).
- Respuestas de `FEParamGetCondicionIvaReceptor` y de `FEParamGetTiposCbte`.
- Pedido y respuesta de `FECAESolicitar` para Factura C, con el CAE parcialmente redactado, y un rechazo provocado a propósito (por ejemplo número fuera de secuencia) para el manejo de errores.
- Versión y fecha del manual de WSFEv1 usado (las fuentes secundarias no coinciden en la numeración).
- Ningún secreto en git: `.env.example` sin valores, clave privada cifrada y registros con token y sign redactados.

## Cuándo activamos el plan B

Usamos fechas concretas del [roadmap](./01-propuesta.md#17-roadmap-del-proyecto) de la propuesta, para no discutirlo cuando ya sea tarde:

| Fecha límite | Tenemos que tener | Si no lo tenemos |
| --- | --- | --- |
| 12/10 (fin de la fase 6 del roadmap) | Certificado de homologación y ticket de acceso de WSAA funcionando | Pasamos al escalón 1 |
| 20/10 | Al menos una factura autorizada en homologación con CAE real de prueba | Pasamos al escalón 2 |
| 25/10 (fin de la fase 7 del roadmap) | Flujo completo desde el botón "Facturar", con manejo de errores | Pasamos al escalón 3 |

## Escalones

**Escalón 1.** Seguimos con la integración, pero pasan a P1 todas las funcionalidades opcionales para liberar tiempo: Central de Deudores del BCRA, WhatsApp con Kapso y reportes exportables. El equipo completo ayuda con ARCA.

**Escalón 2.** Además, dejamos para P1 lo que agrega complejidad fiscal y no es central:

- notas de crédito y de débito;
- facturas con concepto "productos y servicios" a la vez (el P0 queda en productos o servicios);
- facturas en moneda extranjera;
- reconciliación automática periódica (queda como acción manual desde la pantalla de la factura).

**Escalón 3.** Si al 25/10 no logramos el flujo completo, presentamos la facturación con la implementación simulada de `ArcaClient`, identificada claramente en pantalla y en el PDF como "comprobante de prueba, sin validez fiscal". Junto con eso mostramos la evidencia de lo que sí funcionó contra homologación (ticket de WSAA, respuestas de WSFEv1) y documentamos qué faltó y por qué. El resto del sistema (clientes, movimientos, pagos, dashboard) no cambia.

## Qué nunca pasa a P1

Pase lo que pase con ARCA, estas funcionalidades se mantienen porque son el núcleo del producto:

- registro, inicio de sesión y organización;
- clientes con historial;
- ingresos y egresos con categorías;
- facturas con ítems y cálculo de totales;
- pagos parciales sin duplicar ingresos;
- dashboard con facturado contra cobrado;
- cotización del dólar del BCRA.
