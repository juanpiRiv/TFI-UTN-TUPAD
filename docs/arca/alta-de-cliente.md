# Cómo conecta un cliente su cuenta de ARCA

Guía para una persona monotributista que quiere facturar desde la aplicación. Hoy todo es en el ambiente de **homologación**: los comprobantes tienen CAE real de prueba y **no tienen validez fiscal**. El comprobante lo avisa en una franja amarilla.

## Lo que se hace en ARCA

La hace la persona titular del CUIT, con su clave fiscal. Los pasos y comandos exactos están en el [plan B de ARCA](../06-plan-b-arca.md), sección "Cómo se tramita el certificado de homologación".

1. Generar una clave privada de 2048 bits y un pedido de certificado (CSR) con el CUIT en el campo `serialNumber`.
2. En WSASS, pedir el certificado de homologación con ese pedido.
3. Autorizar el servicio `wsfe` para ese certificado.
4. Tener un punto de venta habilitado para facturar por web service.

La clave privada tiene que quedar **sin contraseña** y guardada fuera de cualquier repositorio.

## Lo que se hace en la aplicación

1. Entrar a **Organización** (`/organizacion`) y completar el CUIT y los datos fiscales.
2. En la tarjeta **Facturación electrónica con ARCA**, cargar el certificado y la clave (por archivo o pegando el texto).
3. La aplicación comprueba que el certificado esté vigente, que la clave corresponda a ese certificado y que el CUIT del certificado sea el de la organización. Si algo falla, lo explica.
4. Crear una factura, **Facturar** y, desde la factura, abrir **el comprobante** para imprimirlo o guardarlo como PDF.

## Qué pasa con los datos

- La clave privada se guarda cifrada (AES-256-GCM) y no vuelve a mostrarse. Se puede **Desconectar** en cualquier momento y se borra.
- Si la organización no cargó una credencial y el servidor está en modo `sdk`, **Facturar** responde con un mensaje claro y no emite nada.
- Con el proveedor simulado (demo) no hace falta nada de esto, pero los comprobantes dicen "sin validez fiscal" y no llevan QR.

## Lo que todavía no está

- Producción: bloqueada a propósito.
- El ticket de acceso compartido está en un archivo; para más de una instancia hace falta guardarlo en la base.
- Vencimiento del certificado: la pantalla lo muestra, pero no hay aviso previo.
