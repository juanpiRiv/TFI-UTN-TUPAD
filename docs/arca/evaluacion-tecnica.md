# Evaluación técnica: cómo integrar ARCA, con un cliente propio o con una librería

Oscar, esto es lo que hicimos para decidir cómo hablar con ARCA. Empezamos por explicar qué implica integrarla, después cómo lo habríamos hecho solos y qué hace la librería por nosotros, y recién ahí comparamos y decidimos. Última actualización: 22/10/2026.

## Qué pidió Oscar y dónde está

| Pedido | Dónde está |
|---|---|
| Comparar un cliente propio con una librería | Secciones 2, 3 y 4 |
| Una interfaz propia para ARCA (`FiscalProvider`) | Sección 6 y el código de `feature/arca-fiscal-provider` |
| Decisión justificada | Sección 6 |
| Evidencia trazable | Sección 5 (respuestas reales guardadas) y sección 8 (fuentes oficiales) |
| Qué no está probado | Sección 7 |

## 1. Qué hay que hacer para facturar con ARCA

Para emitir una factura electrónica, nuestro sistema tiene que hablar con dos servicios de ARCA, uno después del otro:

1. **Loguearse (WSAA).** Armamos un pedido en XML (el TRA), lo firmamos con nuestro certificado y se lo mandamos a ARCA. Si todo está bien, nos devuelve un **ticket**: un pase que vale 12 horas y que hay que reutilizar.
2. **Pedir la factura (WSFEv1).** Mandamos los datos de la factura en un formato XML muy estricto (SOAP), con el ticket. ARCA contesta si la **aprobó** (y nos da el **CAE**, el número que la vuelve válida), si la **rechazó** o si la aprobó con observaciones.

Palabras que aparecen más abajo: *homologación* es el ambiente de pruebas de ARCA, donde las facturas no tienen validez; *certificado* es el archivo que identifica a quien factura; *CAE* es el código de autorización de la factura.

## 2. Cómo lo habríamos hecho sin la librería (alternativa A)

Es lo que armamos en el cliente propio, leyendo los manuales oficiales y el WSDL (el archivo que describe los mensajes del servicio). Habría que escribir nosotros cada uno de estos pasos:

| Paso | Qué tendríamos que hacer | Para qué sirve |
|---|---|---|
| Armar el TRA | Generar el XML con un identificador, la fecha de generación, la de expiración y el servicio | Es el pedido de ticket |
| Firmarlo | Firmar con la clave privada y el certificado (usamos `node-forge`) | ARCA comprueba que el pedido es de quien dice ser |
| Llamar al login | Mandar el pedido firmado a `loginCms` | Obtener el ticket |
| Guardar el ticket | Leer el token y la firma, y reutilizarlos 12 horas. Si ARCA ya tiene uno vigente, el login falla con `coe.alreadyAuthenticated` | No pedir un ticket por cada factura |
| Armar los mensajes SOAP | Construir el XML de cada llamada y leer la respuesta (usamos `fast-xml-parser` y `fetch`) | Es el idioma en que habla WSFEv1 |
| Completar el pedido de factura | Importes, IVA, tipo de comprobante y documento del receptor, campo por campo | Un campo mal armado y ARCA rechaza la factura |
| Interpretar la respuesta | Traducir aprobada, rechazada, parcial, observaciones y errores a algo que el sistema entienda | Que el resto del sistema sepa qué pasó con la factura |

Lo difícil no fue escribir el código, fue entender qué hacer. Los manuales y el WSDL no siempre coinciden: varios ejemplos del manual usan SOAP 1.2 y el servicio real respondió SOAP 1.1. Y hay decisiones que el manual no resuelve: cuándo reutilizar el ticket, cómo tratar una respuesta con observaciones y qué hacer cuando ARCA falla y no sabemos si la factura quedó registrada. Esto es una apreciación del equipo, no una medición.

## 3. Qué hace la librería por nosotros (alternativa B)

`facturas@0.25.2` ya trae resueltos los pasos de la tabla: arma el TRA, lo firma, hace el login, guarda el ticket, arma los mensajes SOAP y lee las respuestas. Nosotros llamamos a funciones del estilo "dame el último comprobante autorizado" o "pedí el CAE".

La usamos por sus capas bajas (`client.wsfe.*`) y no por `client.issue()`, que hace todo de una vez y esconde el flujo. Así mantenemos visible lo que pasa.

**Lo que la librería no resuelve y sigue a nuestro cargo:**
- El certificado y la autorización en WSASS (ya lo tramitamos, ver sección 5).
- El alta del punto de venta.
- Traducir la condición de IVA del receptor a los códigos de ARCA.
- Convertir importes: la librería usa centavos enteros y el proyecto usa texto decimal.
- Qué hacer cuando ARCA no responde y no sabemos si la factura quedó registrada, sin duplicarla.
- Avisar en pantalla y en el PDF cuando una factura salió del simulador y no tiene validez fiscal.

Tampoco nos ahorra leer el manual: para validar las reglas fiscales que aplica igual hay que contrastarlas con la documentación oficial.

## 4. Comparación

No medimos horas, así que no damos números que no tenemos. Lo que sí medimos:

| | A: cliente propio | B: librería |
|---|---|---|
| Código nuestro | Unas 940 líneas, más el WSDL de ARCA copiado al repositorio | Unas 340 líneas de adaptador |
| Qué controlamos | Todo | Lo que la librería deja ver |
| Mantenimiento | Lo mantenemos nosotros | La librería es joven: 18 versiones entre el 26/09 y el 13/10, un mantenedor principal |
| Si el login falla | Tenemos el error de ARCA completo | Devuelve un resultado indeterminado sin el código de la falla |
| Flexibilidad | Algoritmo de firma y TRA configurables | No deja cambiar el endpoint, ver el XML firmado ni el algoritmo de firma |
| Probado contra ARCA real | Igual que B | Igual que A |

Las dos dependen de `node-forge` para firmar. Ninguna está más validada que la otra: llegaron al mismo punto real.

## 5. Qué probamos de verdad contra ARCA

Todo lo real es de homologación y está guardado en [`respuestas-reales/`](./respuestas-reales/). Lo del 19/10 se hizo antes de tener certificado, con un CUIT falso y un certificado autofirmado de prueba:

| Prueba | Resultado |
|---|---|
| `FEDummy` (¿está vivo el servicio?) | OK con A y con B ([A](./respuestas-reales/A-fedummy.txt), [B](./respuestas-reales/B-01-fedummy.txt)) |
| Login con un pedido inválido | Error 500, `cms.bad` ([captura](./respuestas-reales/A-wsaa-cms-invalido.txt)) |
| Login con el certificado autofirmado | Rechazado: `cms.cert.untrusted`, con A y con B ([A](./respuestas-reales/A-wsaa-autofirmado-sha256.txt), [B](./respuestas-reales/B-02-ultimo-autofirmado.txt)) |
| WSFEv1 con un token inventado | Error 600 ([captura](./respuestas-reales/A-wsfe-token-inventado.txt)) |

Todo lo demás (tests, errores, resultados aprobado, rechazado y parcial) se probó contra un simulador local armado desde el WSDL oficial. Sirve para validar nuestro código, pero no prueba cómo responde ARCA.

**Novedad del 22/10:** el certificado de homologación ya existe, válido hasta el 21/10/2028, y se creó la autorización al servicio `wsfe`. El paso a paso y los mensajes de ARCA están en [`docs/06-plan-b-arca.md`](../06-plan-b-arca.md). Todavía no corrimos el login real con ese certificado, así que no sabemos si ARCA acepta nuestro pedido de ticket ni qué algoritmo de firma pide.

## 6. Decisión

**Elegimos B como camino principal, A como respaldo y un cliente simulado para la demo y los tests.** Las tres opciones quedan detrás de la misma interfaz, `FiscalProvider`, así que cambiar de una a otra no toca el resto del sistema.

Por qué B:
1. **Menos código nuestro para mantener y revisar** (unas 340 líneas contra unas 940).
2. **A no resultó más correcta que B contra ARCA.** La ventaja de A era el control y la comprensión, no la corrección demostrada.
3. **Entender el protocolo no depende de la librería.** El flujo de la sección 1 lo documentamos desde los manuales y lo recorrimos entero con A.

Riesgos que asumimos: la librería es joven, no deja diagnosticar bien un rechazo del login, y sus reglas citan el manual 4.7.

**Cuándo volveríamos a A:** si con el certificado real ARCA rechaza algo y no podemos diagnosticarlo con B, o si la librería deja de mantenerse o rompe su API. A ya está implementada.

Es una decisión nuestra, no algo que diga ARCA.

## 7. Qué falta

- **Prueba real con el certificado:** algoritmo de firma (SHA-1 o SHA-256), formato de fechas del pedido, resultados reales de factura aprobada, rechazada y parcial, y los catálogos de ARCA. Está en el issue #138.
- **Punto de venta:** no verificamos qué tipo corresponde a un monotributista; lo vamos a consultar a ARCA.
- **Interfaz `FiscalProvider`:** A y B no se comportan igual ante un error 600 o una falla del login (A lanza una excepción, B devuelve un resultado indeterminado), y falta correr la suite de contrato sobre los dos. Falta también elegir el proveedor por configuración (`ARCA_PROVIDER`) y mostrar la leyenda "sin validez fiscal" cuando se use el simulador. Son los issues #134, #135 y #136.
- **Edición del manual:** hay dos (4.7 y 4.8), y la 4.8 vuelve obligatorio `CondicionIVAReceptorId`. No pudimos confirmar cuál rige hoy ni desde cuándo.
- **Mediciones:** la latencia sale de muy pocas capturas de un solo día, y no medimos horas de trabajo.

## 8. Fuentes oficiales

Solo valen la documentación oficial de ARCA y las respuestas reales de homologación. La documentación de la librería, su código y nuestro simulador no prueban cómo responde ARCA. Todas las páginas se consultaron el 19/10/2026.

| Qué afirmamos | Fuente |
|---|---|
| El pedido de ticket se firma con CMS y el ticket dura 12 horas y hay que reutilizarlo | Especificación técnica del WSAA 1.2.2, p. 7 y 10: https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf |
| Errores del login (por ejemplo `coe.alreadyAuthenticated`) | Misma especificación, p. 8 |
| Formato de fechas del pedido y preguntas frecuentes | Manual del desarrollador del WSAA, p. 13, 32 y 33: https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf |
| Cómo obtener el certificado de homologación | Manual de WSASS, p. 3 y 5: https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf |
| Llamadas de WSFEv1, ticket obligatorio y errores 500, 501, 502, 600, 601, 602 | Manual de WSFEv1 V4.8, p. 19, 21 y 125: https://www.afip.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf |
| Edición anterior del manual de WSFEv1 | V4.7: https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf |
| Servicios y mensajes de WSFEv1 y del WSAA en homologación | Los WSDL publicados por ARCA para homologación |

Las páginas indicadas son las que citamos en la evaluación original. Qué edición del manual rige hoy y cuál es el dominio vigente de los servicios (`afip.gov.ar` o `arca.gov.ar`) no lo pudimos confirmar.

## Dónde está el código

- `feature/arca-fiscal-provider`: la interfaz, el simulador y los tests de contrato.
- `feature/arca-sdk-client`: B, apilada sobre la anterior.
- `spike/arca-directo`: A, queda como respaldo, sin PR.
