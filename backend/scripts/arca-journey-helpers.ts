/** Ayudas del recorrido `pnpm arca:journey`: una CA descartable en memoria que firma certificados como lo haría ARCA. */
import { webcrypto } from 'node:crypto'
import * as x509 from '@peculiar/x509'

x509.cryptoProvider.set(webcrypto as unknown as Crypto)

const SERIAL_NUMBER_OID = '2.5.4.5'
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) } as const
const DAY = 86_400_000

const toPem = (label: string, der: ArrayBuffer): string => {
  const base64 = Buffer.from(der).toString('base64')
  return `-----BEGIN ${label}-----\n${base64.match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----`
}

export interface ThrowawayCa {
  /** Firma el certificado de un CSR (o de una clave pública dada) con el sujeto indicado. */
  issue(input: { publicKey: x509.PublicKey | CryptoKey; cuit: string; notBefore?: Date; notAfter?: Date }): Promise<string>
  /** Par clave + certificado nuevos, firmado por la CA. */
  issuePair(input: { cuit: string }): Promise<{ certificate: string; privateKey: string }>
}

const subjectFor = (cuit: string) =>
  new x509.Name([{ C: ['AR'] }, { O: ['Journey Test'] }, { CN: [`tfi${cuit}`] }, { [SERIAL_NUMBER_OID]: [`CUIT ${cuit}`] }])

export async function createThrowawayCa(): Promise<ThrowawayCa> {
  const caKeys = (await webcrypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair
  const caName = new x509.Name([{ C: ['AR'] }, { O: ['Journey Throwaway CA'] }, { CN: ['journey-ca'] }])
  const now = Date.now()
  let serial = 1
  const nextSerial = () => (serial++).toString(16).padStart(8, '0')

  const issue: ThrowawayCa['issue'] = async ({ publicKey, cuit, notBefore, notAfter }) => {
    const cert = await x509.X509CertificateGenerator.create({
      serialNumber: nextSerial(),
      subject: subjectFor(cuit),
      issuer: caName,
      notBefore: notBefore ?? new Date(now - DAY),
      notAfter: notAfter ?? new Date(now + 365 * DAY),
      signingKey: caKeys.privateKey,
      publicKey,
      signingAlgorithm: RSA,
    })
    return cert.toString('pem').trim()
  }

  return {
    issue,
    async issuePair({ cuit }) {
      const keys = (await webcrypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair
      const certificate = await issue({ publicKey: keys.publicKey, cuit })
      const privateKey = toPem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', keys.privateKey))
      return { certificate, privateKey }
    },
  }
}

/** Clave pública del CSR devuelto por la API y los campos de su sujeto. */
export function readCsr(csrPem: string) {
  const request = new x509.Pkcs10CertificateRequest(csrPem)
  const field = (name: string) => request.subjectName.getField(name)
  return {
    publicKey: request.publicKey,
    country: field('C'),
    organization: field('O'),
    commonName: field('CN'),
    serialNumber: field(SERIAL_NUMBER_OID),
  }
}

/** Texto que nunca debe aparecer en una respuesta de error: PEM, tokens SOAP, trazas de pila. */
const LEAK_PATTERNS: [string, RegExp][] = [
  ['PEM', /-----BEGIN/],
  ['traza de pila', /\n\s+at\s+\S+.*:\d+:\d+|node_modules|\.ts:\d+/],
  ['SOAP/ticket', /<token>|<sign>|<soap|loginTicketResponse|<ns\d*:/i],
]
export function leaks(text: string): string[] {
  return LEAK_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name)
}

/** CUIT válido y aleatorio (prefijo 20/23/27/30) con su dígito verificador. */
export function randomCuit(validCuitFrom: (base: string) => string): string {
  const prefix = ['20', '23', '27', '30'][Math.floor(Math.random() * 4)]
  const body = String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
  return validCuitFrom(`${prefix}${body}`)
}
