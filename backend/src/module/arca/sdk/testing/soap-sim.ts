/**
 * SIMULACION LOCAL de WSAA y WSFEv1 para tests. No es ARCA ni es homologacion.
 *
 * Las formas de los mensajes salen de los WSDL oficiales de homologacion bajados el 2026-10-19:
 *  - WSAA:  https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl  (loginCms / in0 / loginCmsReturn)
 *  - WSFE:  https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL    (namespace http://ar.gov.afip.dif.FEV1/)
 * El SOAP Fault de WSAA copia la forma de la respuesta real capturada (faultcode "ns1:<codigo>", HTTP 500).
 * Los codigos de WSAA usados estan en la Especificacion Tecnica WSAA 1.2.2, PDF p.8.
 * Los codigos y textos de Err/Obs que se inyectan en los escenarios son DATOS DE PRUEBA: solo 10016 y 10030 figuran
 * en el ejemplo del Manual WSFEv1 V4.8 (PDF p.82); no se afirma su significado.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type WsaaMode = 'ok' | 'untrusted' | 'already_authenticated' | 'unavailable'

export type CaeScenario =
  | 'authorized'
  | 'authorized_with_obs'
  | 'rejected_detail'
  | 'rejected_header_errors'
  | 'auth_error_600'
  | 'infra_error_500'
  | 'contradictory'
  | 'no_cae_approved'
  | 'http_500_html'
  | 'soap_fault'
  | 'garbage'
  | 'hang'

export interface RecordedRequest {
  path: string
  operation: string
  contentType: string
  soapAction: string | undefined
  body: string
}

export interface SimState {
  wsaaMode: WsaaMode
  caeScenario: CaeScenario
  lastNumber: number
  dummy: 'ok' | 'down'
  requests: RecordedRequest[]
  wsaaLogins: number
  tra: string[]
}

const NS = 'http://ar.gov.afip.dif.FEV1/'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${name}>`).exec(xml)
  return m?.[1]
}

function soapOk(inner: string, soap12: boolean): string {
  const ns = soap12 ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/'
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="${ns}"><soap:Body>${inner}</soap:Body></soap:Envelope>`
}

function wsaaFault(code: string, text: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' +
    `<soapenv:Fault><faultcode xmlns:ns1="http://xml.apache.org/axis/">ns1:${code}</faultcode><faultstring>${esc(text)}</faultstring></soapenv:Fault>` +
    '</soapenv:Body></soapenv:Envelope>'
  )
}

function caeResponse(state: SimState, req: string): string {
  const pto = tag(req, 'PtoVta') ?? '1'
  const tipo = tag(req, 'CbteTipo') ?? '11'
  const nro = tag(req, 'CbteDesde') ?? '1'
  const docTipo = tag(req, 'DocTipo') ?? '80'
  const docNro = tag(req, 'DocNro') ?? '0'
  const concepto = tag(req, 'Concepto') ?? '1'
  const fch = tag(req, 'CbteFch') ?? '20261019'
  const cab = (res: string) =>
    `<FeCabResp><Cuit>20000000001</Cuit><PtoVta>${pto}</PtoVta><CbteTipo>${tipo}</CbteTipo><FchProceso>20261019120000</FchProceso><CantReg>1</CantReg><Resultado>${res}</Resultado><Reproceso>N</Reproceso></FeCabResp>`
  const det = (res: string, extra: string, obs = '') =>
    `<FeDetResp><FECAEDetResponse><Concepto>${concepto}</Concepto><DocTipo>${docTipo}</DocTipo><DocNro>${docNro}</DocNro><CbteDesde>${nro}</CbteDesde><CbteHasta>${nro}</CbteHasta><CbteFch>${fch}</CbteFch><Resultado>${res}</Resultado>${obs}${extra}</FECAEDetResponse></FeDetResp>`
  const obsXml = (items: Array<[number, string]>) =>
    `<Observaciones>${items.map(([c, m]) => `<Obs><Code>${c}</Code><Msg>${esc(m)}</Msg></Obs>`).join('')}</Observaciones>`
  const cae = '<CAE>70000000000001</CAE><CAEFchVto>20261029</CAEFchVto>'
  const wrap = (inner: string) =>
    `<FECAESolicitarResponse xmlns="${NS}"><FECAESolicitarResult>${inner}</FECAESolicitarResult></FECAESolicitarResponse>`
  switch (state.caeScenario) {
    case 'authorized':
      state.lastNumber = Number(nro)
      return wrap(cab('A') + det('A', cae))
    case 'authorized_with_obs':
      state.lastNumber = Number(nro)
      return wrap(cab('A') + det('A', cae, obsXml([[10030, 'observacion de prueba']])))
    case 'rejected_detail':
      return wrap(cab('R') + det('R', '', obsXml([[10016, 'rechazo de prueba uno'], [10030, 'rechazo de prueba dos']])))
    case 'rejected_header_errors':
      return wrap(
        `<FeCabResp><Cuit>20000000001</Cuit><PtoVta>${pto}</PtoVta><CbteTipo>${tipo}</CbteTipo><FchProceso>20261019120000</FchProceso><CantReg>1</CantReg><Resultado>R</Resultado><Reproceso>N</Reproceso></FeCabResp><Errors><Err><Code>10002</Code><Msg>error de prueba a nivel request</Msg></Err></Errors>`,
      )
    case 'auth_error_600':
      // Forma copiada de una respuesta REAL de homologacion (token inventado, 2026-10-19T22:12:39Z): solo <Errors>,
      // sin FeCabResp ni FeDetResp. El texto de Msg es el real, recortado.
      return wrap('<Errors><Err><Code>600</Code><Msg>ValidacionDeToken: No valido token.</Msg></Err></Errors>')
    case 'infra_error_500':
      return wrap('<Errors><Err><Code>500</Code><Msg>Error interno de aplicacion</Msg></Err></Errors>')
    case 'contradictory':
      return wrap(cab('A') + det('R', cae))
    case 'no_cae_approved':
      return wrap(cab('A') + det('A', ''))
    default:
      return ''
  }
}

export interface SoapSim {
  readonly port: number
  readonly state: SimState
  reset(): void
  close(): Promise<void>
}

export async function startSoapSim(): Promise<SoapSim> {
  const state: SimState = {
    wsaaMode: 'ok',
    caeScenario: 'authorized',
    lastNumber: 41,
    dummy: 'ok',
    requests: [],
    wsaaLogins: 0,
    tra: [],
  }

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const contentType = String(req.headers['content-type'] ?? '')
      const soap12 = contentType.includes('soap+xml')
      const send = (status: number, payload: string, type = 'text/xml; charset=utf-8') => {
        res.writeHead(status, { 'Content-Type': type })
        res.end(payload)
      }
      const path = req.url ?? ''

      if (path.startsWith('/ws/services/LoginCms')) {
        state.requests.push({ path, operation: 'loginCms', contentType, soapAction: req.headers.soapaction as string | undefined, body })
        const in0 = tag(body, 'in0') ?? ''
        const der = Buffer.from(in0, 'base64')
        const ascii = der.toString('latin1')
        if (der[0] !== 0x30 || !ascii.includes('loginTicketRequest')) {
          return send(500, wsaaFault('cms.bad', 'El CMS no es valido'))
        }
        const traStart = ascii.indexOf('<loginTicketRequest')
        const traEnd = ascii.indexOf('</loginTicketRequest>')
        if (traStart >= 0 && traEnd > traStart) state.tra.push(ascii.slice(traStart, traEnd + '</loginTicketRequest>'.length))
        if (state.wsaaMode === 'untrusted') return send(500, wsaaFault('cms.cert.untrusted', 'Certificado no emitido por AC de confianza'))
        if (state.wsaaMode === 'already_authenticated')
          return send(500, wsaaFault('coe.alreadyAuthenticated', 'El CEE ha solicitado un ticket de acceso para el cual ya dispone de TA validos'))
        if (state.wsaaMode === 'unavailable') return send(500, wsaaFault('wsaa.unavailable', 'WSAA momentaneamente fuera de servicio'))
        state.wsaaLogins += 1
        const exp = new Date(Date.now() + 12 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, '-00:00')
        const gen = new Date(Date.now() - 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '-00:00')
        const ta =
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><loginTicketResponse version="1.0"><header><source>cn=simulado</source><destination>cn=prueba</destination><uniqueId>1</uniqueId><generationTime>${gen}</generationTime><expirationTime>${exp}</expirationTime></header>` +
          `<credentials><token>TOKEN-SIMULADO-${state.wsaaLogins}</token><sign>SIGN-SIMULADO-${state.wsaaLogins}</sign></credentials></loginTicketResponse>`
        return send(
          200,
          soapOk(`<loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><loginCmsReturn>${esc(ta)}</loginCmsReturn></loginCmsResponse>`, false),
        )
      }

      if (path.startsWith('/wsfev1/service.asmx')) {
        const op = /<(?:[\w-]+:)?Body[^>]*>\s*<(?:[\w-]+:)?(\w+)/.exec(body)?.[1] ?? 'desconocida'
        state.requests.push({ path, operation: op, contentType, soapAction: req.headers.soapaction as string | undefined, body })
        if (op === 'FEDummy') {
          if (state.dummy === 'down') return send(503, 'Service Unavailable', 'text/plain')
          return send(
            200,
            soapOk(`<FEDummyResponse xmlns="${NS}"><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse>`, soap12),
          )
        }
        // Operaciones autenticadas: Auth{Token,Sign,Cuit} es obligatorio (WSDL: FEAuthRequest).
        const token = tag(body, 'Token')
        const sign = tag(body, 'Sign')
        const cuit = tag(body, 'Cuit')
        if (!token?.startsWith('TOKEN-SIMULADO') || !sign?.startsWith('SIGN-SIMULADO') || !cuit) {
          return send(
            200,
            soapOk(`<${op}Response xmlns="${NS}"><${op}Result><Errors><Err><Code>600</Code><Msg>Auth incompleto</Msg></Err></Errors></${op}Result></${op}Response>`, soap12),
          )
        }
        if (op === 'FECompUltimoAutorizado') {
          return send(
            200,
            soapOk(
              `<FECompUltimoAutorizadoResponse xmlns="${NS}"><FECompUltimoAutorizadoResult><PtoVta>${tag(body, 'PtoVta')}</PtoVta><CbteTipo>${tag(body, 'CbteTipo')}</CbteTipo><CbteNro>${state.lastNumber}</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`,
              soap12,
            ),
          )
        }
        if (op === 'FECAESolicitar') {
          switch (state.caeScenario) {
            case 'http_500_html':
              return send(500, '<html><body>Internal Server Error</body></html>', 'text/html')
            case 'soap_fault':
              return send(
                500,
                '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>falla simulada</faultstring></soap:Fault></soap:Body></soap:Envelope>',
              )
            case 'garbage':
              return send(200, '<<<no es xml>>>')
            case 'hang':
              return // no responde: el cliente corta por timeout
            default:
              return send(200, soapOk(caeResponse(state, body), soap12))
          }
        }
        return send(500, 'operacion no simulada', 'text/plain')
      }
      send(404, 'not found', 'text/plain')
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    state,
    reset() {
      state.wsaaMode = 'ok'
      state.caeScenario = 'authorized'
      state.lastNumber = 41
      state.dummy = 'ok'
      state.requests.length = 0
      state.wsaaLogins = 0
      state.tra.length = 0
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
