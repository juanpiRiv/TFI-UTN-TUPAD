# Cómo conecta un cliente su cuenta de ARCA

Guía para una persona monotributista que quiere facturar desde la aplicación. Hoy todo es en el ambiente de **homologación**: los comprobantes tienen CAE real de prueba y **no tienen validez fiscal**. El comprobante lo avisa en una franja amarilla.

## Conexión por delegación (recomendada)

Con el **modo delegado** la persona no genera certificados ni solicitudes: le **delega** a la plataforma el servicio de facturación electrónica en ARCA, y la plataforma emite en su nombre con su propio certificado. El comprobante sale siempre con el CUIT de la persona como emisor. Está disponible cuando la plataforma lo tiene habilitado; si la tarjeta de ARCA de la organización no muestra la opción, se usa el camino con certificado propio de más abajo.

1. **Delegar en ARCA.** La hace la persona titular del CUIT, con clave fiscal de **nivel 3** o superior. Ingresar a ARCA con su CUIT y clave fiscal, abrir el **Administrador de Relaciones de Clave Fiscal** y elegir **Nueva Relación**. En **Buscar**, seguir *ARCA > Web Services > Facturación Electrónica*. En **Representante**, poner el **CUIT de la plataforma** (la aplicación lo muestra en la tarjeta) y **Confirmar**.
2. **Tener un punto de venta.** Con el tipo "Factura Electrónica - Web Services": ARCA no permite emitir por web service con un punto de venta de otro tipo. Hay que crearlo también en la aplicación.
3. **Verificar en la aplicación.** En la tarjeta **Facturación electrónica con ARCA**, elegir **Verificar**. La aplicación hace una consulta de solo lectura (el último comprobante de su punto de venta) y, si ARCA acepta la delegación, queda **verificada** y ya se puede facturar. Si responde que todavía no figura, revisar los datos del paso 1 y volver a verificar.

Notas:

- A veces la delegación queda pendiente hasta que la plataforma la **acepta** como representante. Si la verificación falla justo después de delegar, esperar unos minutos y reintentar.
- Se puede quitar la conexión desde la aplicación, pero la delegación solo se revoca en el Administrador de Relaciones de ARCA.
- Una delegación verificada en homologación no vale en producción: en producción se vuelve a verificar.
- En **homologación** el servicio de autorizaciones (WSASS) no permite delegar a otro CUIT, así que el caso real de dos CUIT distintos solo se puede comprobar en **producción**. En homologación el modo delegado se prueba con el mismo CUIT de la plataforma o con pruebas automáticas.

### Límite conocido de la delegación

Verificar prueba que **alguien** delegó el servicio de facturación de ese CUIT a la plataforma, no que quien lo pide sea el dueño del CUIT. Si un tercero registra en la aplicación el CUIT de un cliente que ya delegó, antes que el propio cliente, podría verificar y facturar a su nombre. Por eso el modo delegado conviene habilitarlo solo para clientes conocidos. Mitigaciones posibles, aún sin implementar: validar la razón social contra el padrón de ARCA, aprobación manual de cada alta o verificación por correo. Otras defensas ya activas: el CUIT de la plataforma no se puede registrar como organización, cambiar el CUIT de la organización borra la delegación verificada y la verificación admite un pedido cada 15 segundos por organización.

## Conexión con certificado propio (alternativa)

### Cómo se conecta: tres pasos

No hace falta instalar `openssl` ni manejar la clave privada: la aplicación genera la clave y el pedido de certificado (CSR), y la persona solo lleva el CSR a ARCA y sube el certificado que ARCA le devuelve. El detalle de los pasos en ARCA está en el [plan B de ARCA](../06-plan-b-arca.md), sección "Cómo se tramita el certificado de homologación".

1. **Generar la solicitud en la aplicación.** En **Organización** (`/organizacion`), con el CUIT y los datos fiscales completos, en la tarjeta **Facturación electrónica con ARCA**, elegir generar la solicitud de certificado. La aplicación muestra el CSR para copiarlo. La clave privada se queda en el servidor, cifrada, y no se muestra nunca. Generar otra solicitud reemplaza la anterior.
2. **Pedir el certificado en ARCA.** La hace la persona titular del CUIT, con su clave fiscal.
   - En **homologación**: en WSASS, *Nuevo Certificado*, con un alias de solo letras y números y el CSR pegado. ARCA devuelve el certificado (`.crt`) para descargar. Después, *Crear autorización a servicio*: el alias, el CUIT representado y el servicio `wsfe`.
   - En **producción**: en *Administración de Certificados Digitales*, con el mismo CSR; después asociar el servicio `wsfe` al alias en *Administrador de Relaciones*. Producción todavía está bloqueada en la aplicación.
   - Tener un punto de venta habilitado para facturar por web service (tipo "Factura Electrónica - Web Services"): ARCA no permite emitir por web service con un punto de venta de otro tipo.
3. **Subir el certificado.** Volver a la tarjeta y cargar el `.crt` que descargó de ARCA (por archivo o pegando el texto). La aplicación usa la clave guardada, comprueba que el certificado esté vigente, que corresponda a esa clave y que el CUIT del certificado sea el de la organización, y si algo falla lo explica. Si el certificado no corresponde a la solicitud más reciente, hay que generar otra y repetir el paso 2.

Después: crear una factura, **Facturar** y, desde la factura, abrir **el comprobante** para imprimirlo o guardarlo como PDF.

#### Si ya tiene certificado y clave

Quien ya generó su propia clave y su certificado puede cargar los dos en la misma tarjeta (**Ya tengo certificado y clave**). La clave tiene que estar **sin contraseña** y guardada fuera de cualquier repositorio.

## Qué comprobantes se probaron contra ARCA

En homologación, con `pnpm arca:e2e` (`E2E_SCENARIOS=basic,services,receiver`), se emitieron y verificaron con `FECompConsultar` facturas C a consumidor final, de servicios con período y vencimiento de pago, y a receptores identificados con CUIT (Responsable Inscripto y Monotributo) y con DNI. Al facturar a un receptor con CUIT, ARCA exige que el CUIT figure en el padrón y que no sea el del emisor. El detalle está en `docs/arca/respuestas-reales/D-servicios-y-receptor-identificado-15-11-2026.txt`.

## Qué pasa con los datos

- La clave privada se guarda cifrada (AES-256-GCM) y no vuelve a mostrarse, tanto la generada por la aplicación como la cargada por el cliente. Mientras la solicitud espera el certificado, su clave también está cifrada. Se puede **Desconectar** en cualquier momento y se borran la credencial y cualquier solicitud pendiente.
- Si la organización no cargó una credencial y el servidor está en modo `sdk`, **Facturar** responde con un mensaje claro y no emite nada.
- Con el proveedor simulado (demo) no hace falta nada de esto, pero los comprobantes dicen "sin validez fiscal" y no llevan QR.

## Lo que todavía no está

- Producción: bloqueada a propósito.
- El ticket de acceso compartido está en un archivo; para más de una instancia hace falta guardarlo en la base.
- Vencimiento del certificado: la pantalla lo muestra, pero no hay aviso previo.
