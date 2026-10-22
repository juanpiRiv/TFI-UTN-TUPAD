# Fixtures

WSDL oficiales de homologacion, bajados tal cual el 2026-10-19:

- `wsfev1-homo.wsdl`: https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL
- `wsaa-homo.wsdl`: https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl

Los usa el servidor SOAP local de los tests (`sim-server.ts`) para validar
nombres y orden de los elementos de cada peticion. No se editan a mano.

Respuestas REALES de homologacion capturadas el 2026-10-19 (`real-*.xml`), con
certificado autofirmado de prueba, CUIT inventado y token/sign inventados:

- `real-fedummy.xml`: FEDummy.
- `real-wsaa-cert-untrusted.xml`: loginCms con certificado autofirmado (SoapFault `cms.cert.untrusted`).
- `real-wsfe-ultimo-auth-600.xml` y `real-wsfe-cae-auth-600.xml`: error 600 de WSFEv1 ante token invalido.

Los crudos con la peticion completa estan en la carpeta de evidencia del spike.
