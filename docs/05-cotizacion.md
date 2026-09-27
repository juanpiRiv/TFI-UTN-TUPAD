# Cotización que usamos

La cátedra nos pidió una definición concreta de qué cotización usa el sistema. La respuesta corta es que hay dos cotizaciones distintas y no hay que mezclarlas: la **de gestión**, que usamos para mostrarle al usuario sus números, y la **fiscal**, que exige ARCA cuando se factura en moneda extranjera.

## Cotización de gestión (la que usa el sistema)

Es la que se aplica a los movimientos cargados en dólares, para convertirlos a pesos y poder sumarlos en el dashboard.

- **Fuente:** API de Estadísticas Cambiarias del BCRA, que es pública y no requiere autenticación. El endpoint es `GET https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD` con los parámetros `fechadesde` y `fechahasta`.
- **Moneda:** solo dólar estadounidense (`USD`) en el P0.
- **Valor:** el campo `tipoCotizacion` de la respuesta, que es la cotización en pesos que publica el BCRA para esa fecha. En la prueba técnica F4-2 vamos a confirmar con datos reales que el campo tiene el valor que esperamos, comparándolo contra lo publicado en la web del BCRA.
- **Fecha:** la del movimiento. Si ese día no hay cotización (fin de semana, feriado, o todavía no se publicó), usamos la del último día hábil anterior que tenga dato.
- **Se guarda una copia:** el movimiento guarda el valor usado en su propio `exchange_rate`. Si más adelante cambia la cotización, los movimientos viejos no se tocan (RN-06).
- **Se puede corregir a mano:** si el usuario cobró a otro tipo de cambio (por ejemplo, vendió los dólares en el banco), puede escribir el valor. En ese caso la cotización se guarda con origen `MANUAL`.

### Cómo la guardamos

Consultamos al BCRA una vez por día, o cuando alguien necesita una fecha que todavía no tenemos, y guardamos el resultado en `exchange_rates` con `source = 'BCRA'`, `rate_type = 'ESTADISTICAS_CAMBIARIAS'`, de `USD` a `ARS`, junto con la fecha a la que corresponde y la fecha y hora de la consulta (RN-13). Así no le pegamos a la API en cada movimiento, y si el BCRA no responde seguimos funcionando con la última cotización guardada. En ese caso el sistema muestra de qué fecha es el dato. Si no hay ninguna cotización guardada, el usuario la carga a mano: nunca bloqueamos el registro de un movimiento porque una API externa esté caída.

### Por qué la oficial del BCRA y no otra

Evaluamos las cotizaciones que usa la gente en la práctica:

- **Dólar blue:** es la que muchos usan en la calle, pero no tiene una fuente oficial ni una API pública estable, y cada sitio publica un valor distinto. No podemos justificar un número fiscal o de gestión con eso.
- **Mayorista de referencia (Comunicación A 3500):** es oficial y la publica el BCRA, pero es el precio entre bancos, no el que ve un monotributista cuando cobra o paga. Si en la prueba F4-2 la API de Estadísticas Cambiarias no nos sirve, es la alternativa.
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
