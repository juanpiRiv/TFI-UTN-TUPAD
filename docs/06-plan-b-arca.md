# Plan B si ARCA se atrasa

La integración con ARCA es la parte más incierta del proyecto: depende de conseguir el certificado de homologación, de entender bien WSAA y WSFEv1, y de que los servicios de prueba estén disponibles. Por eso decidimos de antemano qué hacemos si se complica, en lugar de improvisar sobre la fecha.

## Qué hacemos para bajar el riesgo desde ahora

- **El spike de ARCA arranca ya y lo lleva una sola persona**, en paralelo con el resto del desarrollo (fase 5 del [backlog](./BACKLOG.md)). La idea es tener lo antes posible un ticket de WSAA y una primera llamada válida a WSFEv1 en homologación.
- **ARCA queda aislada detrás de una interfaz propia** (`ArcaClient`) con dos implementaciones: la real, que habla con los web services de homologación, y una simulada, que responde como ARCA (CAE de prueba, rechazos, timeouts). El resto del sistema no sabe con cuál está hablando. Así la facturación se puede desarrollar y probar sin depender de ARCA, y si ARCA se atrasa no frena a nadie.
- **La factura existe sin ARCA.** El borrador, los ítems, los totales, el PDF y los pagos no dependen de tener CAE. Lo único que agrega ARCA es la autorización.

## Cuándo activamos el plan B

Usamos fechas concretas del [roadmap](./01-propuesta.md#17-roadmap-del-proyecto), para no discutirlo cuando ya sea tarde:

| Fecha límite | Tenemos que tener | Si no lo tenemos |
| --- | --- | --- |
| 12/10 (fin de fase 6) | Certificado de homologación y ticket de acceso de WSAA funcionando | Pasamos al escalón 1 |
| 20/10 | Al menos una factura autorizada en homologación con CAE real de prueba | Pasamos al escalón 2 |
| 25/10 (fin de fase 7) | Flujo completo desde el botón "Facturar", con manejo de errores | Pasamos al escalón 3 |

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
