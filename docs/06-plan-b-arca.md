# Integración con ARCA: plan, decisión y plan B

La integración con ARCA es la parte más incierta del proyecto: depende de conseguir el certificado de homologación, de entender bien WSAA y WSFEv1, y de que los servicios de prueba estén disponibles. Este documento cuenta cómo lo pensamos al principio, qué hacemos ahora y por qué, en qué estado estamos y qué hacemos si ARCA se atrasa. El análisis que sustenta la decisión está en la [evaluación técnica](./arca/evaluacion-tecnica.md).

## Cómo lo pensamos al principio

- La plataforma emite comprobantes electrónicos desde el backend, hablando con WSAA (autenticación) y WSFEv1 (facturación), primero en homologación ([propuesta](./01-propuesta.md)).
- ARCA queda aislada detrás de una interfaz propia, con una implementación real y una simulada que responde como ARCA (CAE de prueba, rechazos, timeouts). El resto del sistema no sabe con cuál habla, así que la facturación se puede desarrollar sin depender de ARCA.
- No armar WSAA y WSFEv1 a mano si no hace falta. La primera opción era la librería `facturas` (con la versión exacta fijada, porque todavía es 0.x), y si no servía, `@afipsdk/afip.js`. Antes de decidir, le consultamos a Oscar si podíamos usar una librería (issue #109).
- El spike lo lleva una sola persona y arranca ya, en paralelo con el resto del desarrollo.
- La factura existe sin ARCA: el borrador, los ítems, los totales y los pagos no dependen de tener CAE. Lo que agrega ARCA es la autorización (el CAE, su vencimiento y el número definitivo). Sin CAE el comprobante no tiene efectos fiscales (RG 4291, art. 12), así que un PDF previo es un borrador sin validez fiscal.

## Qué hacemos ahora y por qué

Oscar nos pidió evaluar dos alternativas con evidencia antes de decidir: **A**, un cliente propio sobre la documentación oficial, y **B**, la librería. Hicimos un spike de cada una detrás de una interfaz nuestra, `FiscalProvider`, que reemplaza a la interfaz que habíamos pensado al principio (`ArcaClient`).

**Decisión (21/10/2026):**
- **Camino principal: B**, la librería `facturas@0.25.2`, usada por sus capas bajas y no por `client.issue()`, que esconde el flujo.
- **Respaldo: A**, el cliente propio, implementado detrás de la misma interfaz.
- **Demo y tests: un cliente simulado**, identificado como "sin validez fiscal".

Es una decisión nuestra, no de ARCA. En resumen, elegimos B porque deja menos código nuestro para mantener (unas 340 líneas contra unas 940) y porque A no resultó más correcta contra ARCA: las dos llegaron al mismo punto real. Entender el protocolo no depende de la librería, porque lo recorrimos entero con A. Los riesgos que asumimos, los pasos que la librería nos ahorra y qué nos haría volver a A están en la [evaluación técnica](./arca/evaluacion-tecnica.md).

Para el spike, "primera llamada válida a WSFEv1" es consultar el último comprobante autorizado (`FECompUltimoAutorizado`) con el ticket, no solo `FEDummy`. Además, `CondicionIVAReceptorId` se manda siempre. Fuente oficial: el manual de WSFEv1 v4.8 (historial de versiones, p. 15) dice que pasa a ser obligatorio y deja en desuso los códigos 10245 y 825; el rechazo por ausencia es el 10246. La fecha efectiva del rechazo en producción **no está verificada**: el 01/12/2026 es la fecha de revisión del manual, no una fecha de rechazo.

## Estado al 22/10/2026

El hito del 12/10 (certificado de homologación y ticket de acceso funcionando) **no se cumplió**: el certificado se emitió recién el 22/10 y se autorizó al servicio `wsfe`. Faltan el punto de venta y la primera prueba real contra el WSAA (#138). Pasamos al escalón 1. Si el 20/10 tampoco se llegó a una factura con CAE de prueba, seguimos en el escalón 2. Hoy la demo corre con el cliente simulado, más la evidencia real del registro de abajo.

### Registro del spike

Se completa solo con lo que pasó de verdad. Si algo se bloquea, se anota el mensaje de error tal cual. Sin credenciales: nada de claves, tokens ni CUIT reales.

| Fecha | Paso | Resultado | Evidencia |
| --- | --- | --- | --- |
| 19/10/2026 | `FEDummy` real en homologación (clientes A y B) | OK en los tres campos | [Evaluación técnica](./arca/evaluacion-tecnica.md) |
| 19/10/2026 | `loginCms` con CMS inválido | HTTP 500, `cms.bad` | [Evaluación técnica](./arca/evaluacion-tecnica.md) |
| 19/10/2026 | `loginCms` con TRA firmado con un certificado autofirmado de prueba (CUIT falso), A con SHA-1 y SHA-256, y B | `cms.cert.untrusted` en todos los casos. No sabemos si el WSAA evalúa el resto del TRA antes o después del certificado | [Evaluación técnica](./arca/evaluacion-tecnica.md) |
| 19/10/2026 | WSFEv1 con Token y Sign inventados | HTTP 200 y error 600 | [Evaluación técnica](./arca/evaluacion-tecnica.md) |
| 22/10/2026 | WSASS: adherir el servicio desde el Administrador de Relaciones | Error: `La autorizacion: <CUIT>-<CUIT>-web://wsass-<CUIT> ya existe.` (ticket de ARCA 47540556). La adhesión ya existía; tras cerrar sesión y volver a entrar, WSASS apareció entre los servicios | n/a |
| 22/10/2026 | WSASS, Crear autorización a servicio, antes de tener certificado | El formulario avisa que el CUIT no tiene ningún certificado creado y que hay que usar primero Nuevo Certificado | n/a |
| 22/10/2026 | WSASS, Nuevo Certificado con el alias `tfi-tupad` | Rechazado: `El Nombre simbólico del DN sólo puede contener números y/o letras.` | n/a |
| 22/10/2026 | WSASS, Nuevo Certificado con un alias alfanumérico y el CSR | Certificado emitido, válido del 22/10/2026 al 21/10/2028. Guardado fuera del repositorio | n/a |
| 22/10/2026 | WSASS, Crear autorización a servicio (`wsfe`) con el alias del certificado | Autorización creada por el titular del CUIT. **No se guardó el mensaje exacto que devolvió ARCA**; queda pendiente confirmarla en WSASS, Autorizaciones | n/a |
| 22/10/2026 | Alta del punto de venta para web service | Pendiente: el tipo para monotributista NO está verificado; se consulta a `wsfev1@arca.gov.ar` | n/a |

Todo lo posterior a la autenticación (ticket real, `FECompUltimoAutorizado`, `FECAESolicitar`) queda sin probar hasta correr la primera prueba real con el certificado. Las pruebas contra el simulador local no cuentan como pruebas contra ARCA.

### Cómo se tramita el certificado de homologación

Es el procedimiento que seguimos el 22/10/2026. Sirve solo para el ambiente de homologación: los certificados de WSASS no valen en producción. Lo hace la persona titular del CUIT, con su clave fiscal, porque no se puede delegar. La clave privada y el CSR se generan y quedan fuera del repositorio.

1. Generar la clave privada de 2048 bits: `openssl genrsa -out MiClavePrivada.key 2048`.
2. Generar el pedido de certificado (CSR) con el CUIT en `serialNumber`, con el formato `CUIT <11 dígitos>`: `openssl req -new -key MiClavePrivada.key -subj "/C=AR/O=Empresa/CN=Sistema/serialNumber=CUIT <CUIT>" -out MiPedidoCSR.csr`. Si el CUIT queda mal en el pedido, ARCA lo rechaza: se verifica con `openssl req -in MiPedidoCSR.csr -noout -subject`.
3. En ARCA, con clave fiscal de persona física, adherir el servicio WSASS: Administrador de Relaciones, Adherir Servicio, ARCA, Servicios Interactivos. Después hay que cerrar sesión y volver a entrar para que WSASS aparezca. Si la adhesión ya existe, ARCA responde que la autorización ya existe y no hay que repetirla.
4. En WSASS, Nuevo Certificado: un alias que solo tenga letras y números (el guion se rechaza) y el contenido completo del CSR. El resultado es el certificado en formato PEM.
5. Guardar ese certificado fuera del repositorio y comprobar que corresponde a la clave privada comparando el módulo de los dos.
6. En WSASS, Crear autorización a servicio: el alias del certificado, el CUIT representado y el servicio `wsfe`. No se puede hacer antes del paso 4.
7. Dar de alta el punto de venta para web service. El tipo exacto para un monotributista **NO está verificado**: consultar a `wsfev1@arca.gov.ar`.

Registrar cada paso con la fecha y el mensaje exacto que devuelve ARCA, copiado en el momento: el de la autorización a `wsfe` no se guardó y no se puede reconstruir. Un certificado, un equipo a la vez. Las claves, los CSR y los certificados se guardan en una carpeta con permisos solo para el titular y nunca en el repositorio (`.gitignore` excluye `*.key`, `*.csr`, `*.crt`, `*.pem`, `*.pfx` y `*.p12`). Cuánto tarda en activarse la autorización: NO VERIFICADO.

## Plan B si ARCA se atrasa

### Cuándo lo activamos

Usamos fechas concretas del [roadmap](./01-propuesta.md#17-roadmap-del-proyecto) de la propuesta, para no discutirlo cuando ya sea tarde:

| Fecha límite | Tenemos que tener | Si no lo tenemos |
| --- | --- | --- |
| 12/10 (fin de la fase 6 del roadmap) | Certificado de homologación y ticket de acceso de WSAA funcionando | Pasamos al escalón 1 |
| 20/10 | Al menos una factura autorizada en homologación con CAE real de prueba | Pasamos al escalón 2 |
| 25/10 (fin de la fase 7 del roadmap) | Flujo completo desde el botón "Facturar", con manejo de errores | Pasamos al escalón 3 |

### Escalones

**Escalón 1.** Seguimos con la integración, pero pasan a P1 todas las funcionalidades opcionales para liberar tiempo: Central de Deudores del BCRA, WhatsApp con Kapso y reportes exportables. El equipo completo ayuda con ARCA.

**Escalón 2.** Además, dejamos para P1 lo que agrega complejidad fiscal y no es central:

- notas de crédito y de débito;
- facturas con concepto "productos y servicios" a la vez (el P0 queda en productos o servicios);
- facturas en moneda extranjera;
- reconciliación automática periódica (queda como acción manual desde la pantalla de la factura).

**Escalón 3.** Si al 25/10 no logramos el flujo completo, presentamos la facturación con el cliente simulado, identificado claramente en pantalla y en el PDF como "comprobante de prueba, sin validez fiscal". Junto con eso mostramos la evidencia de lo que sí funcionó contra homologación (ticket de WSAA, respuestas de WSFEv1) y documentamos qué faltó y por qué. El resto del sistema (clientes, movimientos, pagos, dashboard) no cambia.

### Qué nunca pasa a P1

Pase lo que pase con ARCA, estas funcionalidades se mantienen porque son el núcleo del producto:

- registro, inicio de sesión y organización;
- clientes con historial;
- ingresos y egresos con categorías;
- facturas con ítems y cálculo de totales;
- pagos parciales sin duplicar ingresos;
- dashboard con facturado contra cobrado;
- cotización del dólar del BCRA.
