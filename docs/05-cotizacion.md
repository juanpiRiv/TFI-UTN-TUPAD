# Cotización que usamos

La cátedra nos pidió una definición concreta de qué cotización usa el sistema. La respuesta corta es que hay dos cotizaciones distintas y no hay que mezclarlas: la **de gestión**, que usamos para mostrarle al usuario sus números, y la **fiscal**, que exige ARCA cuando se factura en moneda extranjera.

## Cotización de gestión (la que usa el sistema)

Es la que se aplica a los movimientos cargados en dólares, para convertirlos a pesos y poder sumarlos en el dashboard.

- **Fuente:** API de Estadísticas Cambiarias del BCRA, que es pública y no requiere autenticación. El endpoint es `GET https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD` con los parámetros `fechadesde` y `fechahasta`.
- **Moneda:** solo dólar estadounidense (`USD`) en el P0.
- **Valor:** el campo `tipoCotizacion` de la moneda `USD`, expresado en pesos por dólar. Es la cotización del dólar estadounidense que publica el BCRA en Estadísticas Cambiarias. **No es la Comunicación A 3500**: esa es otra serie, que el mismo endpoint publica con el código `REF`, ni es el vendedor del Banco Nación. En la prueba del 11/10/2026, para el 09/10/2026, la serie `USD` dio 1517,00 y la serie `REF` dio 1515,8766. Una fuente de terceros (dolarapi.com, sin garantía de servicio) mostraba un vendedor de Banco Nación de 1535 en esa misma fecha; es una sola fecha, no un histórico. La definición oficial de qué representa exactamente la serie `USD` (compra, venta o cierre de qué mercado) está **sin verificar**: la documentación del BCRA no la explica. Para cerrar la prueba F4-2 se sugiere consultar a api@bcra.gob.ar y registrar la respuesta en este documento.
- **Fecha:** la del movimiento. Si ese día no hay cotización (fin de semana, feriado, o todavía no se publicó), usamos la del último día hábil anterior que tenga dato. La API no rellena esos huecos: lo resuelve nuestro cliente (ver "Comportamiento del endpoint").
- **Decimales:** los valores llegan con 8 decimales. Se leen y se guardan como `Decimal`, nunca como entero ni como `float`. El modelo de datos ([docs/03](./03-modelo-de-datos.md)) define `ExchangeRate.value` como `decimal(18,6)`: si se quiere conservar los 8 decimales de la API hay que ajustar esa precisión; es una decisión pendiente de alinear con el modelo.
- **Se guarda una copia:** el movimiento guarda el valor usado en su propio `exchange_rate`. Si más adelante cambia la cotización, los movimientos viejos no se tocan (RN-06).
- **Se puede corregir a mano:** si el usuario cobró a otro tipo de cambio (por ejemplo, vendió los dólares en el banco), puede escribir el valor. En ese caso la cotización se guarda con origen `MANUAL`.

### Cómo la guardamos

Consultamos al BCRA una vez por día, o cuando alguien necesita una fecha que todavía no tenemos, y guardamos el resultado en `exchange_rates` con `source = 'BCRA'`, `rate_type = 'ESTADISTICAS_CAMBIARIAS'`, de `USD` a `ARS`, junto con la fecha a la que corresponde y la fecha y hora de la consulta (RN-13). Así no le pegamos a la API en cada movimiento, y si el BCRA no responde seguimos funcionando con la última cotización guardada. En ese caso el sistema muestra de qué fecha es el dato. Si no hay ninguna cotización guardada, el usuario la carga a mano: nunca bloqueamos el registro de un movimiento porque una API externa esté caída.

Solo se guardan los días con dato real; el "último día hábil anterior" se resuelve con una consulta ordenada por fecha, sin insertar fines de semana.

### Comportamiento del endpoint (probado en vivo el 11/10/2026)

| Caso | Respuesta |
| --- | --- |
| Rango con datos | 200, resultados de la fecha más nueva a la más vieja |
| Días sin cotización (fin de semana, feriado) | 200 con lista vacía, sin error. Esos días no aparecen |
| Fecha futura | 400 |
| Se manda una sola fecha | 400: hay que mandar `fechadesde` y `fechahasta` juntas (sin ninguna, devuelve el último día publicado) |
| `limit` | Debe estar entre 10 y 1000 (por defecto 1000) |
| Código de moneda inválido | El cuerpo dice `status` 404 pero el HTTP real es 400: hay que leer el `status` del cuerpo |

Consecuencias para el cliente:

- Para resolver el último día hábil anterior se pide una ventana de unos 10 días (`[fecha - 10 días, fecha]`) y se toma el registro más reciente con `fecha <= fecha del movimiento`. La ventana cubre los feriados largos.
- Antes de llamar se limita la fecha a "hoy" (zona horaria `America/Argentina/Buenos_Aires`), para no recibir el 400 si el usuario carga un movimiento con fecha futura. El dato de hoy puede no estar publicado todavía; la hora de publicación diaria está sin verificar.
- Timeout corto, reintentos solo ante errores de red o 5xx (no ante 400) y validación de que `tipoCotizacion` sea un número mayor a cero.
- No hay límite de uso documentado (sin verificar); 40 llamadas seguidas no dispararon ninguno. Igual conviene cachear.

### Cadena de respaldo

Para obtener la cotización de una fecha, el sistema prueba en este orden y se queda con el primer resultado válido:

1. BCRA, serie `USD` (`source = 'BCRA'`).
2. Caché local: la última cotización guardada, indicando de qué fecha es.
3. BCRA, serie `REF` (Comunicación A 3500), con el mismo endpoint y el mismo cliente HTTP. Se guarda con su propio `rate_type` para no mezclarla con la serie `USD`.
4. Carga manual del usuario (`source = 'MANUAL'`).

### Por qué la oficial del BCRA y no otra

Evaluamos las cotizaciones que usa la gente en la práctica:

- **Dólar blue:** es la que muchos usan en la calle, pero no tiene una fuente oficial ni una API pública estable, y cada sitio publica un valor distinto. No podemos justificar un número fiscal o de gestión con eso.
- **Mayorista de referencia (Comunicación A 3500):** es oficial y la publica el BCRA, pero es el precio entre bancos, no el que ve un monotributista cuando cobra o paga. Si la serie `USD` no nos sirve, la alternativa es el mismo endpoint con el código `REF`, sin otro proveedor.
- **Banco Nación vendedor:** es la que exige ARCA para facturar en moneda extranjera (ver abajo), pero el Banco Nación no tiene una API pública oficial.
- **Estadísticas Cambiarias del BCRA:** es oficial, pública, gratuita, no necesita autenticación y trae el histórico por fecha. Por eso la elegimos para gestión.

Como el usuario puede corregir el valor a mano en cada movimiento, si cobró a otro tipo de cambio sus números igual le cierran.

## Cotización fiscal (la que exige ARCA)

Desde la RG 5616/2024 de ARCA, cuando una factura se emite en moneda extranjera hay que informar el tipo de cambio vendedor divisa del Banco de la Nación Argentina al cierre del día hábil cambiario anterior a la emisión. Esto aplica también a la Factura C. Por web service es obligatorio desde el 15/04/2025. ARCA publica ese valor y se puede consultar con el método `FEParamGetCotizacion` de WSFEv1.

**En el P0 no la necesitamos**, porque todas las facturas se emiten en pesos (`MonId = PES`, cotización 1). Si en P1 agregamos facturas en dólares, la cotización de esa factura la vamos a tomar de ARCA con `FEParamGetCotizacion` y no del BCRA, porque es la que valida ARCA.

## Por qué son dos cosas distintas

| | Gestión | Fiscal |
| --- | --- | --- |
| Para qué sirve | Que el usuario vea sus números en una sola moneda | Cumplir con la normativa al facturar en moneda extranjera |
| Fuente | API del BCRA (Estadísticas Cambiarias) | Banco Nación, informado por ARCA |
| Fecha | La del movimiento, o el último día hábil anterior | Día hábil cambiario anterior a la factura |
| Se puede editar | Sí, queda marcada como manual | No |
| Dónde se guarda | `transactions.exchange_rate` | `invoices.fiscal_exchange_rate` |
| Se usa en el P0 | Sí | No, las facturas son en pesos |

Los dos valores pueden diferir un poco, y está bien: uno es para la gestión interna del usuario y el otro para cumplir con ARCA.

## Fuentes

- [API de Estadísticas Cambiarias del BCRA (anuncio)](https://www2.bcra.gob.ar/noticias/BCRA-API-estadisticas-cambiarias.asp)
- [Documentación del endpoint de cotizaciones por moneda](https://estadisticas-cambiarias.bcra.apidocs.ar/operations/get-cotizaciones-codmoneda)
- [RG 5616/2024 en el Boletín Oficial](https://www.boletinoficial.gob.ar/detalleAviso/primera/318374/20241218)
- [ARCA: novedad sobre la emisión de facturas en moneda extranjera](https://servicioscf.afip.gob.ar/publico/sitio/contenido/novedad/ver.aspx?id=4468)
